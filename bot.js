const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  AuditLogEvent,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

const WL_CHANNEL_ID = '1523391788914708580';
const WL_ROLE_ID = '1523391650867445972';
const LOG_CHANNEL_ID = '1523392065411747870';
const AUTHORISED_ROLE_ID = '1523391574296367194';

// ─── Punishment system ────────────────────────────────────────────
const punishedUsers = new Set();
const roleRemovalTracker = new Map(); // userId -> [timestamps]

const REMOVAL_THRESHOLD = 2;  // more than 2 removals
const REMOVAL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Helper: apply punishment
async function applyPunishment(member, reason, guild) {
  const rolesToKeep = [WL_ROLE_ID];
  const rolesToRemove = member.roles.cache.filter(r => !rolesToKeep.includes(r.id) && r.id !== guild.id);
  if (rolesToRemove.size > 0) {
    await member.roles.remove(rolesToRemove, reason || 'Punishment: security violation');
  }
  punishedUsers.add(member.id);
  return rolesToRemove;
}

// Helper: log punishment event
async function logPunishment(guild, user, actionDetail, rolesRemoved, reason) {
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setTitle('🚨 Security Violation – Punishment Applied')
    .setColor(0xFF0000)
    .setDescription(`**User:** ${user.tag} (${user.id})`)
    .addFields(
      { name: 'Action', value: actionDetail, inline: true },
      { name: 'Roles Removed', value: `${rolesRemoved.size} role(s)` , inline: true },
      { name: 'Remaining Roles', value: `<@&${WL_ROLE_ID}> only` },
      { name: 'Reason', value: reason || 'No further details' }
    )
    .setTimestamp()
    .setFooter({ text: 'Auto Security Log' });
  await logChannel.send({ embeds: [embed] });
}

// Helper: add removal timestamp and check threshold
function trackRoleRemoval(executorId) {
  const now = Date.now();
  if (!roleRemovalTracker.has(executorId)) {
    roleRemovalTracker.set(executorId, []);
  }
  const timestamps = roleRemovalTracker.get(executorId);
  timestamps.push(now);
  // Remove timestamps older than window
  const valid = timestamps.filter(ts => now - ts < REMOVAL_WINDOW_MS);
  roleRemovalTracker.set(executorId, valid);
  return valid.length > REMOVAL_THRESHOLD;
}

// ─── Embed constants (unchanged) ──────────────────────────────────
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

  // ─── 1. Role Deletion Listener ──────────────────────────────
  client.on('roleDelete', async (role) => {
    const guild = role.guild;
    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.RoleDelete,
        limit: 1,
      });
      const entry = auditLogs.entries.first();
      if (!entry) return;
      const executor = entry.executor;
      if (!executor) return;
      const member = guild.members.cache.get(executor.id) || await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      const rolesRemoved = await applyPunishment(member, 'Deleted a role', guild);
      await logPunishment(guild, executor, `Deleted role "${role.name}" (${role.id})`, rolesRemoved, 'Role deletion');
    } catch (err) {
      console.error('Error handling role deletion:', err);
    }
  });

  // ─── 2. Channel Deletion Listener ──────────────────────────
  client.on('channelDelete', async (channel) => {
    const guild = channel.guild;
    if (!guild) return;
    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelDelete,
        limit: 1,
      });
      const entry = auditLogs.entries.first();
      if (!entry) return;
      const executor = entry.executor;
      if (!executor) return;
      const member = guild.members.cache.get(executor.id) || await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      const rolesRemoved = await applyPunishment(member, 'Deleted a channel', guild);
      await logPunishment(guild, executor, `Deleted channel "#${channel.name}" (${channel.id})`, rolesRemoved, 'Channel deletion');
    } catch (err) {
      console.error('Error handling channel deletion:', err);
    }
  });

  // ─── 3. Role Removal Threshold Listener ────────────────────
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Detect role removal (roles that existed in old but not in new)
    const removedRoles = oldMember.roles.cache.filter(
      (role, id) => !newMember.roles.cache.has(id) && role.id !== newMember.guild.id
    );
    if (removedRoles.size === 0) return;

    // Fetch audit log to find who removed these roles
    try {
      const auditLogs = await newMember.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberRoleUpdate,
        limit: 10,
      });
      // Find entry matching this update (target = target member, and $remove includes one of the removed roles)
      const entry = auditLogs.entries.find(
        e => e.target.id === newMember.id && e.changes?.some(c => c.key === '$remove' && removedRoles.has(c.new_value?.id))
      );
      if (!entry) return;
      const executor = entry.executor;
      if (!executor) return;
      const executorMember = newMember.guild.members.cache.get(executor.id) || await newMember.guild.members.fetch(executor.id).catch(() => null);
      if (!executorMember) return;

      // Track this removal action
      const thresholdExceeded = trackRoleRemoval(executor.id);
      if (thresholdExceeded) {
        // Punish the executor
        const rolesRemovedFromExecutor = await applyPunishment(executorMember, 'Removed roles from >2 members in 5 minutes', newMember.guild);
        await logPunishment(newMember.guild, executor,
          `Removed roles from multiple members (exceeded threshold)`,
          rolesRemovedFromExecutor,
          'Mass role removal detected'
        );
        // Clear tracker for this user
        roleRemovalTracker.delete(executor.id);
      }
    } catch (err) {
      console.error('Error checking role removal threshold:', err);
    }
  });

  // ─── 4. Role Addition Prevention (unchanged) ────────────────
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!punishedUsers.has(newMember.id)) return;
    const addedRoles = newMember.roles.cache.filter(
      (role, id) => !oldMember.roles.cache.has(id) && role.id !== WL_ROLE_ID && role.id !== newMember.guild.id
    );
    if (addedRoles.size === 0) return;

    try {
      const auditLogs = await newMember.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberRoleUpdate,
        limit: 10,
      });
      const entry = auditLogs.entries.find(
        e => e.target.id === newMember.id && e.changes?.some(c => c.key === '$add' && addedRoles.has(c.new_value?.id))
      );
      if (!entry) {
        await newMember.roles.remove(addedRoles, 'Punished – role addition blocked');
        return;
      }
      const executor = entry.executor;
      const executorMember = newMember.guild.members.cache.get(executor.id);
      if (!executorMember || !executorMember.roles.cache.has(AUTHORISED_ROLE_ID)) {
        await newMember.roles.remove(addedRoles, 'Punished – role addition blocked');
        // Log unauthorised attempt
        const logChannel = newMember.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
          const warnEmbed = new EmbedBuilder()
            .setTitle('⛔ Unauthorised Role Addition Attempt')
            .setColor(0xFF8800)
            .setDescription(`**Target:** ${newMember.user.tag}\n**Attempted by:** ${executor?.tag || 'Unknown'}\n**Roles:** ${addedRoles.map(r => r.name).join(', ')}`)
            .setTimestamp();
          await logChannel.send({ embeds: [warnEmbed] });
        }
      } else {
        // Authorised staff – lift punishment
        punishedUsers.delete(newMember.id);
        const logChannel = newMember.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
          const liftEmbed = new EmbedBuilder()
            .setTitle('✅ Punishment Lifted')
            .setColor(0x00FF00)
            .setDescription(`**User:** ${newMember.user.tag}\n**Lifted by:** ${executor.tag}`)
            .addFields({ name: 'Authorised Role Given', value: addedRoles.map(r => `<@&${r.id}>`).join(', ') })
            .setTimestamp();
          await logChannel.send({ embeds: [liftEmbed] });
        }
      }
    } catch (err) {
      console.error('Error checking role addition:', err);
      await newMember.roles.remove(addedRoles, 'Punished – safety revert');
    }
  });

  // ─── Start whitelist embed ────────────────────────────────
  await sendEmbed();
  setInterval(refreshEmbed, 30 * 60 * 1000);
});

// ─── Whitelist message handler (unchanged) ───────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
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
