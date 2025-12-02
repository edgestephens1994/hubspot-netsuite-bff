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
      log('Unhandled raw object type from webhook:', rawType);
      return;
    }

    // ⬇️ IMPORTANT: this uses your existing helper, which already
    // pulls associations for deals (companies, line_items, etc.)
    const record = await fetchHubSpotRecord(apiObjectType, objectId);

    log(`Fetched full ${apiObjectType} record from HubSpot:`, record.id);

    switch (apiObjectType) {
      /**
       * COMPANIES → NetSuite Customers
       */
      case 'companies': {
        if (rawEvent === 'creation') {
          log('Handling company.creation → creating Customer in NetSuite', {
            companyId: record.id,
            subscriptionType,
          });
          return await createCustomerInNS(record);
        } else {
          log('Handling company update → updating Customer in NetSuite', {
            companyId: record.id,
            subscriptionType,
            rawEvent,
          });
          return await updateCustomerInNS(record);
        }
      }

      /**
       * CONTACTS → (not wired yet, safe to ignore)
       */
      case 'contacts': {
        log('Received contact event (no NS action wired yet)', {
          contactId: record.id,
          subscriptionType,
          rawEvent,
        });
        return;
      }

      /**
       * PRODUCTS → NetSuite Items
       */
      case 'products': {
        log('Handling product event → create/update Item in NetSuite', {
          productId: record.id,
          subscriptionType,
          rawEvent,
        });
        // Your existing createItemInNS already handles creation path
        return await createItemInNS(record);
      }

      /**
       * DEALS → NS Quote on creation, then transform to SO when Closed Won
       */
      case 'deals': {
        const dealId = record.id?.toString();
        const currentStage = record.properties?.dealstage;

        // 1️⃣ On deal creation → create the Quote in NetSuite (same as before)
        if (rawEvent === 'creation') {
          log('Handling deal.creation → creating Quote in NetSuite', {
            dealId,
            subscriptionType,
          });

          // This function already builds hubspotCompanyId from associations
          // and sends it to the NS RESTlet that creates the Quote.
          return await createSalesOrderInNS(record);
        }

        // 2️⃣ On other deal events, only act when it hits Closed Won
        if (currentStage === CLOSED_WON_STAGE_ID) {
          const externalId = `HSDEAL_${dealId}`;

          log('Deal moved to Closed Won → converting Quote to Sales Order in NetSuite', {
            dealId,
            subscriptionType,
            rawEvent,
            currentStage,
            externalId,
          });

          try {
            // This calls the NetSuite RESTlet that:
            //  - finds the Quote by externalId / hubspotDealId
            //  - transforms it into a Sales Order
            await convertQuoteToSalesOrder(dealId);
          } catch (err) {
            log('Error converting Quote to Sales Order in NetSuite', {
              dealId,
              error: err.message || err,
            });
          }

          return;
        }

        // 3️⃣ All other deal events (not creation and not Closed Won) → ignore
        log('Skipping deal event (not creation and not Closed Won)', {
          dealId,
          subscriptionType,
          rawEvent,
          currentStage,
        });
        return;
      }

      default: {
        log('No handler implemented for apiObjectType:', apiObjectType);
        return;
      }
    }
  } catch (err) {
    if (err.response) {
      log('HubSpot API error:', {
        status: err.response.status,
        data: err.response.data,
      });
    } else {
      log('HubSpot handler error:', err.message || err);
    }
    return;
  }
}










