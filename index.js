const express = require('express');
const { InteractionType, InteractionResponseType } = require('discord.js');
const { verifyKey } = require('discord-interactions');
const nacl = require('tweetnacl');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Discordからのリクエスト署名を検証する関数
function verifyDiscordRequest(req, res, buf) {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const isValid = nacl.sign.detached.verify(
    Buffer.from(timestamp + buf.toString()),
    Buffer.from(signature, 'hex'),
    Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
  );
  if (!isValid) {
    res.status(401).send('Invalid request signature');
    throw new Error('Invalid request signature');
  }
}

// express.raw() を使って署名検証のために生のボディを取得
app.post('/interactions', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    verifyDiscordRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    return;
  }

  const interaction = JSON.parse(req.body.toString());

  // 1. PING-PONG (疎通確認)
  if (interaction.type === InteractionType.Ping) {
    return res.send({ type: InteractionResponseType.Pong });
  }

  // 2. Slash Command の処理
  if (interaction.type === InteractionType.ApplicationCommand) {
    const { name } = interaction.data;

    if (name === 'log') {
      // 非同期処理をすぐに開始し、Discordにはまず「処理中」と応答する
      res.send({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });

      // ユーザー情報とメッセージを取得
      const user = interaction.member.user.username;
      const messageToLog = interaction.data.options.find(opt => opt.name === 'message').value;

      // GASにデータを送信
      await fetch(process.env.GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: user,
          message: messageToLog,
        }),
      });

      // Discordに最終的な応答を送信
      const followupUrl = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
      await fetch(followupUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `「${messageToLog}」を記録しました。`,
        }),
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});