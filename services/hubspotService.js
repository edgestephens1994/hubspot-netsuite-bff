import axios from 'axios';
import { log } from '../utils/logger.js';
import {
  createCustomerInNS,
  updateCustomerInNS,
  createItemInNS,
  createSalesOrderInNS
} from './netsuiteService.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

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

  // 1) On deal creation: you probably already call createQuoteInNetSuite(dealId, ...)

  // 2) On stage → Closed Won
  const CLOSED_WON_STAGE = 'closedwon'; // use the exact internal value from HubSpot

  if (newStage === CLOSED_WON_STAGE) {
    try {
      await convertQuoteToSalesOrder(dealId);
    } catch (err) {
      console.error(`Failed to convert Quote to Sales Order for deal ${dealId}:`, err);
      // you can also log this into HubSpot or NetSuite as needed
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

    const record = await fetchHubSpotRecord(apiObjectType, objectId);

    log(`Fetched full ${apiObjectType} record from HubSpot:`, record.id);

    switch (apiObjectType) {
      case 'companies':
        if (rawEvent === 'creation') {
          // Separate create action
          return await createCustomerInNS(record);
        } else {
          // Any non-creation company event treated as "edit" for now
          return await updateCustomerInNS(record);
        }

      case 'products':
        // TODO: later handle product.creation vs propertyChange similarly
        return await createItemInNS(record);

      case 'deals':
      if (rawEvent === 'creation') {
        log('Handling deal.creation → creating Sales Order in NetSuite', {
          dealId: record.id,
          subscriptionType,
        });
        return await createSalesOrderInNS(record);
      } else {
        log('Skipping Sales Order creation for non-creation deal event', {
          dealId: record.id,
          subscriptionType,
          rawEvent,
        });
        return;
      }

      default:
        log('No handler implemented for apiObjectType:', apiObjectType);
    }
  } catch (err) {
    if (err.response) {
      log('HubSpot API error:', {
        status: err.response.status,
        data: err.response.data
      });
    } else {
      log('HubSpot handler error:', err.message || err);
    }
    return;
  }
}






