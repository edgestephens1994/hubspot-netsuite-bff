import axios from 'axios';
import { log } from '../utils/logger.js';
import {
  createCustomerInNS,
  createItemInNS,
  createSalesOrderInNS
} from './netsuiteService.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Map webhook object type → CRM v3 API object type
// webhook gives "company", "deal", "product"
// CRM v3 wants "companies", "deals", "products"
const HUBSPOT_OBJECT_TYPE_MAP = {
  company: 'companies',
  deal: 'deals',
  product: 'products',
  contact: 'contacts'
};

// Generic fetch for a full HubSpot record
async function fetchHubSpotRecord(apiObjectType, objectId) {
  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set');
  }

  const url = `https://api.hubapi.com/crm/v3/objects/${apiObjectType}/${objectId}`;

  log('Fetching HubSpot record from:', url);

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`
    }
  });

  return response.data;
}

// Main handler for a single webhook event
export async function handleHubSpotEvent(event) {
  try {
    log('Raw HubSpot webhook event:', event);

    const { objectId, subscriptionType } = event;

    if (!objectId || !subscriptionType) {
      log('Event missing objectId or subscriptionType, skipping.');
      return;
    }

    // subscriptionType looks like "company.creation" / "deal.creation" / "product.creation"
    const [rawType] = subscriptionType.split('.');
    const apiObjectType = HUBSPOT_OBJECT_TYPE_MAP[rawType];

    if (!apiObjectType) {
      log('Unhandled raw object type from webhook:', rawType);
      return;
    }

    // Fetch full record from HubSpot
    const record = await fetchHubSpotRecord(apiObjectType, objectId);

    log(`Fetched full ${apiObjectType} record from HubSpot:`, record.id);

    // Route by API object type
    switch (apiObjectType) {
      case 'companies':
        // HubSpot Company → NetSuite Customer
        return await createCustomerInNS(record);

      case 'products':
        // HubSpot Product → NetSuite Item
        return await createItemInNS(record);

      case 'deals':
        // HubSpot Deal → NetSuite Sales Order
        return await createSalesOrderInNS(record);

      default:
        log('No handler implemented for apiObjectType:', apiObjectType);
    }
  } catch (err) {
    // Log as much detail as possible
    if (err.response) {
      log('HubSpot API error:', {
        status: err.response.status,
        data: err.response.data
      });
    } else {
      log('HubSpot handler error:', err.message || err);
    }

    // Re-throw so server.js can log "Webhook error"
  //  throw err;
    return;
  }
}

