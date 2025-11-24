import axios from 'axios';
import { log } from '../utils/logger.js';
import { createCustomerInNS, createItemInNS, createSalesOrderInNS } from './netsuiteService.js';

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Fetch full HubSpot object details
async function fetchHubSpotRecord(objectType, objectId) {
  const url = `https://api.hubapi.com/crm/v3/objects/${objectType}/${objectId}`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`
    }
  });

  return response.data;
}

// Main handler for webhook events
export async function handleHubSpotEvent(event) {
  const { objectId, objectType, eventType } = event;

  log(`Processing event: ${objectType} / ${eventType}`);

  // Fetch full record from HubSpot
  const record = await fetchHubSpotRecord(objectType, objectId);

  // Route by object type
  switch (objectType) {
    case "companies":
      return createCustomerInNS(record);

    case "products":
      return createItemInNS(record);

    case "deals":
      return createSalesOrderInNS(record);

    default:
      log("Unhandled object type:", objectType);
  }
}

