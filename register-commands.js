const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('log')
    .setDescription('メッセージをスプレッドシートに記録します。')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('記録するメッセージ')
        .setRequired(true))
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully registered slash commands.');
  } catch (error) {
    console.error(error);
  }
})();