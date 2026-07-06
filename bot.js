const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const WL_CHANNEL_ID = '1523391788914708580';
const WL_ROLE_ID = '1523391650867445972';

// ─── Embed constants ──────────────────────────────────────────────
const EMBED_TITLE = 'STRZ Whitelist';
const EMBED_DESCRIPTION = 'To get whitelisted, simply type **wl** in this channel.\n\n> Make sure you follow the rules.';
const EMBED_IMAGE = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400667320815822/Screenshot_20260705_171214_Discord.jpg?ex=6a4ca1ae&is=6a4b502e&hm=036363d063bc9ba28f14d4485d3330e6a79d8e5c29bcbd9246354d4443978309&';
const EMBED_THUMBNAIL = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400669128556797/Untitled104_20260705142221.png?ex=6a4ca1ae&is=6a4b502e&hm=ed7cde8b7a896175d7d48f2750f3f0bc12e5f40ed6410d520fca612c69888804&';
const EMBED_FOOTER_TEXT = 'STRZ WHITELIST';
const EMBED_FOOTER_ICON = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400669128556797/Untitled104_20260705142221.png?ex=6a4ca1ae&is=6a4b502e&hm=ed7cde8b7a896175d7d48f2750f3f0bc12e5f40ed6410d520fca612c69888804&';

// ─── Ready ─────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Send whitelist embed to the WL channel
  const wlChannel = client.channels.cache.get(WL_CHANNEL_ID);
  if (!wlChannel) {
    console.error(`❌ WL channel ${WL_CHANNEL_ID} not found.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(EMBED_TITLE)
    .setDescription(EMBED_DESCRIPTION)
    .setColor(0x9B59B6) // purple, you can change
    .setImage(EMBED_IMAGE)
    .setThumbnail(EMBED_THUMBNAIL)
    .setFooter({ text: EMBED_FOOTER_TEXT, iconURL: EMBED_FOOTER_ICON });

  try {
    await wlChannel.send({ embeds: [embed] });
    console.log('✅ Whitelist embed sent.');
  } catch (err) {
    console.error('❌ Failed to send embed:', err);
  }
});

// ─── Message Handler ──────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  // Ignore bots and messages outside the WL channel
  if (message.author.bot) return;
  if (message.channel.id !== WL_CHANNEL_ID) return;

  const content = message.content.trim().toLowerCase();

  if (content === 'wl') {
    // Whitelist the user
    try {
      const member = message.member;
      if (!member) return; // edge case

      // Check if they already have the role
      if (member.roles.cache.has(WL_ROLE_ID)) {
        // Already whitelisted – maybe silently ignore or react
        await message.react('✅');
        return;
      }

      await member.roles.add(WL_ROLE_ID, 'Whitelist via wl command');
      await message.react('✅');

      // Optional: send a quick success message and delete after 3 seconds
      const successMsg = await message.reply({ content: '✅ You have been whitelisted!', ephemeral: false });
      setTimeout(() => successMsg.delete().catch(() => {}), 3000);
    } catch (err) {
      console.error('Error adding whitelist role:', err);
      await message.reply({ content: '❌ An error occurred. Please contact an admin.', ephemeral: true });
    }
  } else {
    // Non‑wl message – delete, reply, then delete reply after 5 seconds
    try {
      // Send prompt
      const reply = await message.reply({
        content: '❌ To get whitelisted, please type **wl** in this channel.\n*(This message will be deleted in 5 seconds)*',
      });

      // Delete user's original message
      await message.delete();

      // Delete the bot's reply after 5 seconds
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 5000);
    } catch (err) {
      console.error('Error handling non‑wl message:', err);
    }
  }
});

// ─── Login ─────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
