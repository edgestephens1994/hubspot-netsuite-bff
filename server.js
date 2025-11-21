import express from 'express';
import bodyParser from 'body-parser';
import { log } from './utils/logger.js';
import { handleHubSpotEvent } from './services/hubspotService.js';

const app = express();
app.use(bodyParser.json());

// Basic test endpoint
app.get('/', (req, res) => {
  res.send('HubSpot → Node.js → NetSuite Integration Running');
});

// Webhook endpoint HubSpot will call
app.post('/hubspot/webhook', async (req, res) => {
  try {
    const events = req.body;

    log('Received HubSpot Webhook:', events);

    // HubSpot can send multiple event objects
    for (const event of events) {
      await handleHubSpotEvent(event);
    }

    res.status(200).send('ok');
  } catch (err) {
    log('Webhook error:', err);
    res.status(500).send('Error');
  }
});

// Render uses PORT environment variable
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
});
