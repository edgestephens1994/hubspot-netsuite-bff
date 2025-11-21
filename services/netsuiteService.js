import axios from 'axios';
import { log } from '../utils/logger.js';

const NS_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `NLAuth nlauth_account=${process.env.NS_ACCOUNT_ID}, 
                    nlauth_consumer_key=${process.env.NS_CONSUMER_KEY}, 
                    nlauth_consumer_secret=${process.env.NS_CONSUMER_SECRET}, 
                    nlauth_token=${process.env.NS_TOKEN_ID}, 
                    nlauth_token_secret=${process.env.NS_TOKEN_SECRET}`
};

export async function createCustomerInNS(contact) {
  log("Creating Customer in NetSuite:", contact.id);

  const response = await axios.post(
    process.env.NS_RESTLET_CUSTOMER_URL,
    { hubspotRecord: contact },
    { headers: NS_HEADERS }
  );

  log("NetSuite Customer Created:", response.data);
  return response.data;
}

export async function createItemInNS(product) {
  log("Creating Item in NetSuite:", product.id);

  const response = await axios.post(
    process.env.NS_RESTLET_ITEM_URL,
    { hubspotRecord: product },
    { headers: NS_HEADERS }
  );

  log("NetSuite Item Created:", response.data);
  return response.data;
}

export async function createSalesOrderInNS(deal) {
  log("Creating Sales Order in NetSuite:", deal.id);

  const response = await axios.post(
    process.env.NS_RESTLET_SALESORDER_URL,
    { hubspotRecord: deal },
    { headers: NS_HEADERS }
  );

  log("NetSuite Sales Order Created:", response.data);
  return response.data;
}
