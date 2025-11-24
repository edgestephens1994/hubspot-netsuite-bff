import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger.js';
import { URLSearchParams } from 'url';

/**
 * Build OAuth 1.0a signature EXACTLY like Postman
 * using HMAC-SHA256 and including query params in base string.
 */
function buildOAuthHeader(method, fullUrl) {
  const {
    NS_ACCOUNT_ID,
    NS_CONSUMER_KEY,
    NS_CONSUMER_SECRET,
    NS_TOKEN_ID,
    NS_TOKEN_SECRET,
  } = process.env;

  method = method.toUpperCase();

  const url = new URL(fullUrl);

  const oauthParams = {
    oauth_consumer_key: NS_CONSUMER_KEY,
    oauth_token: NS_TOKEN_ID,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: "1.0"
  };

  // Include query params in signature (Postman behavior)
  const signatureParams = {
    ...oauthParams,
    ...Object.fromEntries(url.searchParams)
  };

  // Normalize & sort parameters
  const sorted = Object.keys(signatureParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(signatureParams[k])}`)
    .join('&');

  // Base string: METHOD & URL (without query) & parameter string
  const baseString =
    method +
    '&' +
    encodeURIComponent(url.origin + url.pathname) +
    '&' +
    encodeURIComponent(sorted);

  // Signing key
  const signingKey = `${NS_CONSUMER_SECRET}&${NS_TOKEN_SECRET}`;

  // Signature
  const oauthSignature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  // Build Authorization header exactly like Postman
  const header =
    `OAuth realm="${NS_ACCOUNT_ID}",` +
    `oauth_consumer_key="${NS_CONSUMER_KEY}",` +
    `oauth_token="${NS_TOKEN_ID}",` +
    `oauth_signature_method="HMAC-SHA256",` +
    `oauth_timestamp="${oauthParams.oauth_timestamp}",` +
    `oauth_nonce="${oauthParams.oauth_nonce}",` +
    `oauth_version="1.0",` +
    `oauth_signature="${encodeURIComponent(oauthSignature)}"`;

  return header;
}

/**
 * POST to NetSuite
 */
async function postToNetSuite(url, payload) {
  const authHeader = buildOAuthHeader("POST", url);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "Cookie": "NS_ROUTING_VERSION=2"
      }
    });
    log("NetSuite RESTlet response:", response.data);
    return response.data;

  } catch (err) {
    if (err.response) {
      log("NetSuite error:", {
        status: err.response.status,
        data: err.response.data
      });
    } else {
      log("NetSuite error:", err.message);
    }
    throw err;
  }
}

/**
 * HubSpot → NetSuite Customer
 */
export async function createCustomerInNS(company) {
  log("Creating Customer in NetSuite:", company.id);
  return postToNetSuite(process.env.NS_RESTLET_CUSTOMER_URL, {
    hubspotRecord: company
  });
}
