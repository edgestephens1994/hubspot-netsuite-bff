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

  // For deals, include associations (companies + line_items)
  const url =
    apiObjectType === 'deals'
      ? `https://api.hubapi.com/crm/v3/objects/deals/${objectId}?associations=companies, line_items`
      : `https://api.hubapi.com/crm/v3/objects/${apiObjectType}/${objectId}`;

  log('Fetching HubSpot record from:', url);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`
    }
  });

  return response.data;
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
        // TODO: later handle deal.creation vs propertyChange similarly
        return await createSalesOrderInNS(record);

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

