import axios from 'axios';
import { log } from '../utils/logger.js';
import {
  createCustomerInNS,
  updateCustomerInNS,
  createItemInNS,
  createSalesOrderInNS,
  convertQuoteToSalesOrder,    // 👈 NEW import
} from './netsuiteService.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

const CLOSED_WON_STAGE_ID =
  process.env.HUBSPOT_CLOSED_WON_STAGE_ID || 'closedwon';


const HUBSPOT_OBJECT_TYPE_MAP = {
  company: 'companies',
  deal: 'deals',
  product: 'products',
  contact: 'contacts'
};

async function fetchHubSpotRecord(apiObjectType, objectId) {
  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set');
  }

  let url;

  if (apiObjectType === 'deals') {
    // ✅ No space between companies and line_items
    const associationsParam = encodeURIComponent('companies,line_items');

    url = `https://api.hubapi.com/crm/v3/objects/deals/${objectId}?associations=${associationsParam}`;
  } else if (apiObjectType === 'companies') {
    // 🔹 Explicitly request name + address properties
    const properties = [
      'name',
      'address',
      'address2',
      'city',
      'state',
      'zip',
      'country',
      // add any custom fields you use, e.g. 'billing_address', 'shipping_city', etc.
    ].join(',');

    url = `https://api.hubapi.com/crm/v3/objects/companies/${objectId}?properties=${properties}`;
  } else {
    url = `https://api.hubapi.com/crm/v3/objects/${apiObjectType}/${objectId}`;
  }

  log('Fetching HubSpot record from:', url);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`
    }
  });

  return response.data;
}


// Example in hubspotService.js (or wherever you handle deal updates)

async function handleDealUpdate(event) {
  const dealId = event.objectId || event.dealId;
  const newStage = event.properties?.dealstage || event.newValue;

  console.log("HubSpot deal updated:", { dealId, newStage });

  // 1. CREATE QUOTE ON DEAL CREATION
  if (event.changeType === "CREATED") {
    console.log(`Deal ${dealId} created → Creating Quote in NetSuite.`);
    await netsuiteService.createQuoteFromDeal(dealId); // you already have this
  }

  // 2. TRANSFORM QUOTE → SALES ORDER ON CLOSED WON
  const CLOSED_WON = "closedwon";  // your internal HubSpot stage value

  if (newStage === CLOSED_WON) {
    console.log(`Deal ${dealId} is Closed Won → Converting Quote in NetSuite.`);
    try {
      await netsuiteService.convertQuoteToSalesOrder(dealId);
    } catch (err) {
      console.error("Error converting quote to SO:", err);
    }
  }
}



export async function handleHubSpotEvent(event) {
  try {
    log('Raw HubSpot webhook event:', event);

    const { objectId, subscriptionType } = event;

    if (!objectId || !subscriptionType) {
      log('Event missing objectId or subscriptionType, skipping.');
      return;
    }

    // subscriptionType examples:
    // "company.creation", "company.propertyChange", "deal.creation", etc.
    const [rawType, rawEvent] = subscriptionType.split('.');
    const apiObjectType = HUBSPOT_OBJECT_TYPE_MAP[rawType];

    if (!apiObjectType) {
      log('Unsupported HubSpot object type, skipping.', {
        rawType,
        subscriptionType,
      });
      return;
    }

    // Get the full record from HubSpot so we can see latest properties (including dealstage)
    const url = `https://api.hubapi.com/crm/v3/objects/${apiObjectType}/${objectId}`;

    const hsResp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      },
      // You can add more properties if you need them
      params: {
        properties: [
          'dealstage',
          'firstname',
          'lastname',
          'email',
          'phone',
          'name',
          'hs_product_id',
          'quantity',
          'amount',
        ].join(','),
      },
    });

    const record = hsResp.data || {};
    log('Fetched full HubSpot record for event', {
      apiObjectType,
      id: record.id,
      rawType,
      rawEvent,
    });

    // We’ll reuse this in the deals path
    const dealId = record.id?.toString();
    const currentStage = record.properties?.dealstage;
    const CLOSED_WON_STAGE_ID =
      process.env.HUBSPOT_CLOSED_WON_STAGE_ID || 'closedwon';

    switch (apiObjectType) {
      /**
       * COMPANIES → NetSuite Customers
       */
      case 'companies': {
        if (rawEvent === 'creation') {
          log('Handling company.creation → creating Customer in NetSuite', {
            companyId: record.id,
          });
          await createCustomerInNS(record);
        } else {
          log('Handling company update → updating Customer in NetSuite', {
            companyId: record.id,
            rawEvent,
          });
          await updateCustomerInNS(record);
        }
        return;
      }

      /**
       * CONTACTS → (optional) You can wire these if you want later
       */
      case 'contacts': {
        log('Received contact event (no NS action wired yet)', {
          contactId: record.id,
          rawEvent,
        });
        return;
      }

      /**
       * PRODUCTS → NetSuite Items
       */
      case 'products': {
        if (rawEvent === 'creation') {
          log('Handling product.creation → creating Item in NetSuite', {
            productId: record.id,
          });
          await createItemInNS(record);
        } else {
          log('Skipping non-creation product event', {
            productId: record.id,
            rawEvent,
          });
        }
        return;
      }

      /**
       * DEALS → NS Quote on creation, then transform to SO when Closed Won
       */
      case 'deals': {
        // 1) On deal creation → create the Quote in NetSuite
        if (rawEvent === 'creation') {
          log('Handling deal.creation → creating Quote in NetSuite', {
            dealId,
          });

          // This already calls your RESTlet that now creates a Quote (Estimate)
          await createSalesOrderInNS(record);
          return;
        }

        // 2) On any non-creation event, check if the stage is Closed Won
        if (currentStage === CLOSED_WON_STAGE_ID) {
          const externalId = `HSDEAL_${dealId}`;

          log('Deal moved to Closed Won → converting Quote to Sales Order in NetSuite', {
            dealId,
            currentStage,
            externalId,
            rawEvent,
          });

          try {
            // This should send { hubspotDealId, externalId } to your NS transform RESTlet
            await convertQuoteToSalesOrder(dealId);
          } catch (err) {
            log('Error converting Quote to Sales Order in NetSuite', {
              dealId,
              error: err.message || err,
            });
          }

          return;
        }

        // 3) All other deal events (not creation, not Closed Won) → ignore
        log('Skipping deal event (not creation and not Closed Won)', {
          dealId,
          currentStage,
          rawEvent,
        });
        return;
      }

      default: {
        log('No handler implemented for this HubSpot object type', {
          apiObjectType,
          rawType,
          rawEvent,
        });
        return;
      }
    }
  } catch (err) {
    if (err.response) {
      log('HubSpot handler error response from HubSpot:', {
        status: err.response.status,
        data: err.response.data,
      });
    } else {
      log('HubSpot handler error:', err.message || err);
    }
    return;
  }
}








