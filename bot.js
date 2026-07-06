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

let embedMessage = null;

function buildEmbed() {
  return new EmbedBuilder()
    .setTitle(EMBED_TITLE)
    .setDescription(EMBED_DESCRIPTION)
    .setColor(0xFF0000)
    .setImage(EMBED_IMAGE)
    .setThumbnail(EMBED_THUMBNAIL)
    .setFooter({ text: EMBED_FOOTER_TEXT, iconURL: EMBED_FOOTER_ICON });
}

async function sendEmbed() {
  const channel = client.channels.cache.get(WL_CHANNEL_ID);
  if (!channel) {
    console.error(`❌ WL channel ${WL_CHANNEL_ID} not found.`);
    return;
  }
  try {
    const msg = await channel.send({ embeds: [buildEmbed()] });
    embedMessage = msg;
    console.log('✅ Whitelist embed sent.');
  } catch (err) {
    console.error('❌ Failed to send embed:', err);
  }
}

async function refreshEmbed() {
  if (embedMessage) {
    try {
      await embedMessage.delete();
      console.log('🗑️ Old embed deleted.');
    } catch (err) {
      console.error('Failed to delete old embed:', err);
    }
    embedMessage = null;
  }
  await sendEmbed();
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await sendEmbed();
  setInterval(refreshEmbed, 30 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ─── !removeadmin command ───────────────────────────────────────
  if (message.content.trim().startsWith('!removeadmin')) {
    // Check user permission
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need the **Administrator** permission to use this command.');
    }

    // Check bot permission
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply('❌ I need the **Manage Roles** permission to edit roles.');
    }

    const roles = message.guild.roles.cache;
    let removedCount = 0;
    let failedCount = 0;

    for (const role of roles.values()) {
      if (role.permissions.has(PermissionsBitField.Flags.Administrator)) {
        // Ensure the bot can edit this role (hierarchy check)
        if (role.comparePositionTo(message.guild.members.me.roles.highest) >= 0) {
          failedCount++;
          continue; // Bot's highest role is below this role, skip
        }

        try {
          const newPerms = role.permissions.remove(PermissionsBitField.Flags.Administrator);
          await role.setPermissions(newPerms);
          removedCount++;
        } catch (err) {
          console.error(`Failed to remove admin from role ${role.name}:`, err);
          failedCount++;
        }
      }
    }

    await message.reply(
      `✅ Removed ADMINISTRATOR permission from **${removedCount}** role(s).` +
      (failedCount > 0 ? `\n⚠️ Could not modify **${failedCount}** role(s) (probably hierarchy).` : '')
    );
    return; // Exit early, don't process wl channel logic
  }

  // ─── Whitelist channel logic (unchanged) ────────────────────────
  if (message.channel.id !== WL_CHANNEL_ID) return;

  const content = message.content.trim().toLowerCase();

  if (content === 'wl') {
    try {
      const member = message.member;
      if (!member) return;

      if (member.roles.cache.has(WL_ROLE_ID)) {
        await message.reply({ content: 'You are already whitelisted!' });
        return;
      }

      await member.roles.add(WL_ROLE_ID, 'Whitelist via wl command');
      await message.reply({ content: 'You have been whitelisted!' });
    } catch (err) {
      console.error('Error adding whitelist role:', err);
      await message.reply({ content: '❌ An error occurred. Please contact an admin.' });
    }
  } else {
    // Non‑wl message – delete, reply, then delete reply after 5 seconds
    try {
      const reply = await message.reply({
        content: '❌ To get whitelisted, please type **wl** in this channel.\n*(This message will be deleted in 5 seconds)*',
      });

      await message.delete();

      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 5000);
    } catch (err) {
      console.error('Error handling non‑wl message:', err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
