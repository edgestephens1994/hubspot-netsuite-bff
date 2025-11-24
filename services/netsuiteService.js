import axios from 'axios';
import { log } from '../utils/logger.js';

// Build NetSuite auth headers (placeholder for now)
function getNsHeaders() {
  const {
    NS_ACCOUNT_ID,
    NS_CONSUMER_KEY,
    NS_CONSUMER_SECRET,
    NS_TOKEN_ID,
    NS_TOKEN_SECRET
  } = process.env;

  // If any of these are missing, just log and skip the call for now
  if (!NS_ACCOUNT_ID || !NS_CONSUMER_KEY || !NS_CONSUMER_SECRET || !NS_TOKEN_ID || !NS_TOKEN_SECRET) {
    log('NetSuite credentials not fully configured. Skipping NetSuite call.');
    return null;
  }

  // Simple NLAuth-style header (you will later refine this or switch to OAuth1/TokenBased)
  const header = `NLAuth nlauth_account=${NS_ACCOUNT_ID}, ` +
                 `nlauth_consumer_key=${NS_CONSUMER_KEY}, ` +
                 `nlauth_consumer_secret=${NS_CONSUMER_SECRET}, ` +
                 `nlauth_token=${NS_TOKEN_ID}, ` +
                 `nlauth_token_secret=${NS_TOKEN_SECRET}`;

  return {
    'Content-Type': 'application/json',
    'Authorization': header
  };
}

async function postToNetSuite(url, payload) {
  if (!url) {
    log('NetSuite RESTlet URL is not set. Skipping NetSuite call.');
    return;
  }

  const headers = getNsHeaders();
  if (!headers) {
    // getNsHeaders already logged the problem
    return;
  }

  log('Posting to NetSuite RESTlet:', url, 'Payload keys:', Object.keys(payload || {}));

  const response = await axios.post(url, payload, { headers });
  log('NetSuite response:', response.data);
  return response.data;
}

// HubSpot Company → NetSuite Customer
export async function createCustomerInNS(company) {
  log('Creating Customer in NetSuite:', company.id);

  const payload = {
    hubspotRecord: company
    // later we will transform this into a simpler object for the RESTlet
  };

  return postToNetSuite(process.env.NS_RESTLET_CUSTOMER_URL, payload);
}

// HubSpot Product → NetSuite Item
export async function createItemInNS(product) {
  log('Creating Item in NetSuite:', product.id);

  const payload = {
    hubspotRecord: product
  };

  return postToNetSuite(process.env.NS_RESTLET_ITEM_URL, payload);
}

// HubSpot Deal → NetSuite Sales Order
export async function createSalesOrderInNS(deal) {
  log('Creating Sales Order in NetSuite:', deal.id);

  const payload = {
    hubspotRecord: deal
  };

  return postToNetSuite(process.env.NS_RESTLET_SALESORDER_URL, payload);
}
