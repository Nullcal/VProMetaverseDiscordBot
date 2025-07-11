import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// JSONボディをパースするためのミドルウェア
app.use(express.json());

// Endpoint triggered by the GAS scheduler to perform polling
app.post('/poll', async (req, res) => {
  console.log('Polling started...');

  const { DISCORD_BOT_TOKEN, TARGET_CHANNEL_ID, GAS_URL, DISCORD_GUILD_ID } = process.env;
  // GASから送られてきた未完了タスクのIDリストを取得
  const { uncompletedIds = [] } = req.body;

  const discordApiUrl = `https://discord.com/api/v10/channels/${TARGET_CHANNEL_ID}/messages?limit=100`;

  try {
    const discordResponse = await fetch(discordApiUrl, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!discordResponse.ok) throw new Error(`Discord API error: ${discordResponse.statusText}`);

    const messages = await discordResponse.json();
    if (messages.length === 0) {
      return res.status(200).send('No messages found on Discord.');
    }

    const newTasks = [];
    const updatedTasks = [];
    const fluffWords = ['お願いします', 'よろしく', 'です'];
    const LIKE_EMOJI = '👍';

    for (const msg of messages) {
      const isCompletedByReaction = msg.reactions?.some(r => r.emoji.name === LIKE_EMOJI) ?? false;

      // --- 更新チェック ---
      if (uncompletedIds.includes(msg.id) && isCompletedByReaction) {
        updatedTasks.push({
          messageId: msg.id,
          completed: true,
        });
        continue; // 更新対象なので新規タスクとしては扱わない
      }

      // --- 新規タスクチェック ---
      // 既にシートにあるタスク（IDがリストに含まれる）は新規追加しない
      if (uncompletedIds.includes(msg.id)) continue;

      const mentionedUserIds = [...new Set(msg.mentions.map(m => m.id))];
      if (mentionedUserIds.length === 0) continue;

      const memberPromises = mentionedUserIds.map(userId =>
        fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}`, {
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
        }).then(r => r.json())
      );
      const members = await Promise.all(memberPromises);
      const nicknameMap = new Map(members.map(m => [m.user.id, m.nick || m.user.username]));

      const lines = msg.content.split('\n');
      for (const line of lines) {
        const match = line.match(/<@(\d+)>([\s\S]+)/);
        if (!match) continue;

        const userId = match[1];
        let task = match[2].trim();
        const name = nicknameMap.get(userId);

        if (!name || !task) continue;
        
        fluffWords.forEach(word => {
          task = task.replace(new RegExp(word, 'g'), '').trim();
        });

        if (task) {
          newTasks.push({
            messageId: msg.id,
            timestamp: msg.timestamp,
            name,
            task,
            completed: isCompletedByReaction,
          });
        }
      }
    }

    const responsePayload = { newTasks, updatedTasks };
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responsePayload),
    });

    console.log(`Processed: ${newTasks.length} new, ${updatedTasks.length} updated.`);
    res.status(200).send('Polling successful.');

  } catch (error) {
    console.error('Polling failed:', error);
    res.status(500).send('Polling job failed.');
  }
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});