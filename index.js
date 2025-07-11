import express from 'express';
import { InteractionType, InteractionResponseType } from 'discord-api-types/v10';
import { verifyKey } from 'discord-interactions';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to verify requests from Discord for the /interactions endpoint
const verifyDiscordRequest = (clientKey) => {
  return function (req, res, buf, encoding) {
    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');

    const isValidRequest = verifyKey(buf, signature, timestamp, clientKey);
    if (!isValidRequest) {
      res.status(401).send('Bad request signature');
      throw new Error('Bad request signature');
    }
  };
};

// Endpoint for future Slash Command use
app.post('/interactions', express.json({ verify: verifyDiscordRequest(process.env.DISCORD_PUBLIC_KEY) }), async function (req, res) {
  const interaction = req.body;
  if (interaction.type === InteractionType.Ping) {
    return res.send({ type: InteractionResponseType.Pong });
  }

  // Handle commands here if you add them later
  return res.status(404).send('Command not found.');
});


// Endpoint triggered by the GAS scheduler to perform polling
app.get('/poll', async (req, res) => {
  console.log('Polling started...');

  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  const CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
  const GAS_URL = process.env.GAS_WEBHOOK_URL;

  // For a production system, you should save the ID of the last message fetched
  // and use the `after` parameter in the URL to avoid refetching old messages.
  // Example: `&after=${lastMessageId}`
  const discordApiUrl = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=100`;

  try {
    const discordResponse = await fetch(discordApiUrl, {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    });

    if (!discordResponse.ok) {
      throw new Error(`Discord API error: ${discordResponse.statusText}`);
    }

    const messages = await discordResponse.json();

    if (messages.length === 0) {
      console.log('No new messages found.');
      return res.status(200).send('No new messages.');
    }

    // Format messages for GAS
    // Discord returns messages from newest to oldest, so we reverse them
    const formattedMessages = messages.reverse().map((msg) => {
      return {
        id: msg.id,
        timestamp: msg.timestamp,
        user: msg.author.username,
        message: msg.content,
      };
    });

    // Send the formatted messages to the Google Apps Script Web App
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formattedMessages), // Send as an array
    });

    console.log(`Successfully sent ${formattedMessages.length} messages to GAS.`);
    res.status(200).send(`Polling successful. Sent ${formattedMessages.length} messages.`);

  } catch (error) {
    console.error('Polling failed:', error);
    res.status(500).send('Polling job failed.');
  }
});


app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});