import express from 'express';
import { InteractionType, InteractionResponseType } from 'discord-api-types/v10';
import { verifyKey } from 'discord-interactions';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// (略) ... 以前と同じ verifyDiscordRequest と /interactions のコード ...

// Endpoint triggered by the GAS scheduler to perform polling
app.get('/poll', async (req, res) => {
  console.log('Polling started...');

  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  const CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
  const GAS_URL = process.env.GAS_WEBHOOK_URL;

  const discordApiUrl = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=100`;

  try {
    const discordResponse = await fetch(discordApiUrl, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });

    if (!discordResponse.ok) {
      throw new Error(`Discord API error: ${discordResponse.statusText}`);
    }

    const messages = await discordResponse.json();
    if (messages.length === 0) {
      console.log('No new tasks found.');
      return res.status(200).send('No new messages.');
    }

    // --- ここからが新しいデータ処理ロジック ---
    const tasksToLog = [];
    const fluffWords = ['お願いします', 'よろしく', 'です']; // タスクから除外したい文字列

    for (const msg of messages) {
      // 1. メッセージを行ごとに分割
      const lines = msg.content.split('\n');

      for (const line of lines) {
        // 2. <@ユーザーID> タスク という形式に一致するかチェック
        const match = line.match(/<@(\d+)>([\s\S]+)/);
        if (!match) continue; // 一致しない行はスキップ

        const userId = match[1];
        let task = match[2].trim();

        // 3. ユーザーIDからメンション情報を探す
        const mentionedUser = msg.mentions.find(m => m.id === userId);
        if (!mentionedUser) continue; // メンション情報がなければスキップ

        const name = mentionedUser.username; // 注意: これはサーバーニックネームではなく、グローバルなユーザー名です

        // 4. タスクから不要な単語を削除
        for (const word of fluffWords) {
          task = task.replace(word, '').trim();
        }

        if (task) { // タスク内容が空でなければ追加
          tasksToLog.push({ name, task });
        }
      }
    }
    // --- データ処理ロジックここまで ---

    if (tasksToLog.length > 0) {
      // 抽出したタスクの配列をGASに送信
      await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tasksToLog),
      });
      console.log(`Successfully sent ${tasksToLog.length} tasks to GAS.`);
      res.status(200).send(`Polling successful. Sent ${tasksToLog.length} tasks.`);
    } else {
      console.log('No valid tasks to log.');
      res.status(200).send('No valid tasks to log.');
    }

  } catch (error) {
    console.error('Polling failed:', error);
    res.status(500).send('Polling job failed.');
  }
});


app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});