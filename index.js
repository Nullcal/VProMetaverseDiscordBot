import express from 'express';
import { InteractionType, InteractionResponseType } from 'discord-api-types/v10';
import { verifyKey } from 'discord-interactions';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// (略) ... 以前と同じ verifyDiscordRequest と /interactions のコード ...

// Endpoint triggered by the GAS scheduler to perform polling
app.get('/poll', async (req, res) => {
  // --- ここからデバッグ用に修正 ---
  console.log('--- Checking Environment Variables ---');
  const { DISCORD_BOT_TOKEN, TARGET_CHANNEL_ID, GAS_URL, DISCORD_GUILD_ID } = process.env;

  console.log(`DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN ? 'Loaded' : '!!! UNDEFINED !!!'}`);
  console.log(`TARGET_CHANNEL_ID: ${TARGET_CHANNEL_ID ? 'Loaded' : '!!! UNDEFINED !!!'}`);
  console.log(`GAS_URL: ${GAS_URL ? 'Loaded' : '!!! UNDEFINED !!!'}`);
  console.log(`DISCORD_GUILD_ID: ${DISCORD_GUILD_ID ? 'Loaded' : '!!! UNDEFINED !!!'}`);
  console.log('------------------------------------');

  // どれか一つでも未定義なら、エラーを返して処理を停止
  if (!DISCORD_BOT_TOKEN || !TARGET_CHANNEL_ID || !GAS_URL || !DISCORD_GUILD_ID) {
    const errorMessage = 'One or more environment variables are missing.';
    console.error(errorMessage);
    return res.status(500).send(errorMessage);
  }
  // --- デバッグ用コードここまで ---
  
  console.log('Polling started...');

  const { DISCORD_BOT_TOKEN, TARGET_CHANNEL_ID, GAS_URL, DISCORD_GUILD_ID } = process.env;

  if (!DISCORD_GUILD_ID) {
    throw new Error('DISCORD_GUILD_ID is not set in environment variables.');
  }

  const discordApiUrl = `https://discord.com/api/v10/channels/${TARGET_CHANNEL_ID}/messages?limit=100`;

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

    const tasksToLog = [];
    const fluffWords = ['お願いします', 'よろしく', 'です'];

    for (const msg of messages) {
      // --- ここからが新しいニックネーム取得ロジック ---

      // 1. メッセージ内でメンションされているユニークなユーザーIDのリストを作成
      const mentionedUserIds = [...new Set(msg.mentions.map(m => m.id))];

      if (mentionedUserIds.length === 0) continue; // メンションがなければスキップ

      // 2. 全員のサーバーメンバー情報を並行してAPIから取得
      const memberPromises = mentionedUserIds.map(userId =>
        fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}`, {
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
        }).then(res => res.json())
      );
      const members = await Promise.all(memberPromises);

      // 3. ユーザーIDをキー、ニックネームを値とするマップを作成
      const nicknameMap = new Map();
      for (const member of members) {
        if (member.user) {
          // ニックネーム(member.nick)があればそれ、なければユーザー名(member.user.username)を使う
          nicknameMap.set(member.user.id, member.nick || member.user.username);
        }
      }
      // --- ニックネーム取得ロジックここまで ---

      // 4. メッセージを行ごとに処理
      const lines = msg.content.split('\n');
      for (const line of lines) {
        const match = line.match(/<@(\d+)>([\s\S]+)/);
        if (!match) continue;

        const userId = match[1];
        let task = match[2].trim();

        // 5. マップからニックネームを取得
        const name = nicknameMap.get(userId);
        if (!name) continue; // メンバー情報を取得できなかった場合はスキップ

        // 6. タスクから不要な単語を削除
        fluffWords.forEach(word => {
          task = task.replace(new RegExp(word, 'g'), '').trim();
        });

        if (task) {
          tasksToLog.push({ name, task });
        }
      }
    }

    if (tasksToLog.length > 0) {
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