const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  AuditLogEvent,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Partials,
} = require('discord.js');

const client = new Client({
  intents: [
    1,          // Guilds
    2,          // GuildMembers
    4,          // GuildModeration
    512,        // GuildMessages
    32768,      // MessageContent
    16384,      // GuildMessageComponents
    4096,       // DirectMessages (essential for DMs)
  ],
  // Without these, Discord.js silently drops events for anything it hasn't
  // already cached (e.g. a message posted before the bot's cache picked it
  // up, or before a restart) — which was causing most deletions to go unlogged.
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember,
    Partials.User,
    Partials.Reaction,
  ],
});

// ─── IDs ──────────────────────────────────────────────────────────
const WL_CHANNEL_ID = '1523520648008306738';
const WL_ROLE_ID = '1523520328993607690';
const LOG_CHANNEL_ID = '1523520973113135164';
const AUTHORISED_ROLE_ID = '1523520155651538944';
// The ONLY role allowed to grant roles back to a punished user.
// If anyone else adds a role to a punished user, it gets stripped again instantly.
const PUNISHMENT_OVERRIDE_ROLE_ID = '1275403786038280313';
const TICKET_CHANNEL_ID = '1523520763263586354';
const SUPPORT_TEAM_ROLE_ID = '1523520322718924811';
const APPLY_CHANNEL_ID = '1523520760440815706';
const APP_LOG_CHANNEL_ID = '1523520948790231241';
const APP_RESULT_CHANNEL_ID = '1523520774630277150';

// ─── Category IDs for tickets ─────────────────────────────────────
const TICKET_CATEGORIES = {
  'general_support': '1523520333288706158',
  'ban_appeal': '1523520335239188490',
  'staff_report': '1523520388511039498',
  'report_ticket': '1523520377903517796',
  'donations': '1523520386073886830',
};

const TICKET_OPTIONS = [
  { label: 'General Support', value: 'general_support', description: 'Get help with general issues' },
  { label: 'Ban Appeal', value: 'ban_appeal', description: 'Appeal a server ban' },
  { label: 'Staff Report', value: 'staff_report', description: 'Report a staff member' },
  { label: 'Report Ticket', value: 'report_ticket', description: 'Report a problem with a ticket' },
  { label: 'Donations', value: 'donations', description: 'Donation inquiries and support' },
];

// ─── Punishment system ────────────────────────────────────────────
const punishedUsers = new Set();

// Mass role removal tracking: trigger when someone removes roles
// from MORE THAN 3 different members within a 5 minute window.
const roleRemovalTracker = new Map(); // executorId -> [timestamps]
const REMOVAL_THRESHOLD = 3;
const REMOVAL_WINDOW_MS = 5 * 60 * 1000;

// Mass ban tracking: trigger when someone bans MORE THAN 1 person
// within a 30 second window.
const banTracker = new Map(); // executorId -> [timestamps]
const BAN_THRESHOLD = 1;
const BAN_WINDOW_MS = 30 * 1000;

// How recent an audit log entry must be to be trusted as "the" cause
// of the event we just received (Discord audit logs can lag slightly).
const AUDIT_LOG_FRESHNESS_MS = 10000;

// ─── Staff Application System ─────────────────────────────────────
const STAFF_QUESTIONS = [
  'What is your Discord username and age?',
  'Have you ever been staff on a FiveM server before? If yes, describe your experience.',
  'Why do you want to become staff on our FiveM RP/PVP server?',
  'How many hours per week can you dedicate to moderating the server?',
  'A player is repeatedly breaking rules in chat. Describe the steps you would take.',
  'A staff member is abusing their powers. What do you do?',
  'How would you handle a situation where two players are accusing each other of RDM (Random Deathmatch)?',
  'What is your opinion on using OOC (Out of Character) knowledge in IC (In Character) situations?',
  'Describe a time you had to resolve a conflict between players. What was the outcome?',
  'Why should we choose you over other applicants?',
];

const pendingApplications = new Map(); // userId -> { step, answers, author }
const appMessagesMap = new Map(); // messageId -> { userId, embed, row }

// ─── Embeds ───────────────────────────────────────────────────────
const EMBED_IMAGE = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400667320815822/Screenshot_20260705_171214_Discord.jpg';
const EMBED_THUMBNAIL = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400669128556797/Untitled104_20260705142221.png';

let embedMessage = null;
let ticketPanelMessage = null;

// ─── Helper functions ─────────────────────────────────────────────
async function applyPunishment(member, reason, guild) {
  const rolesToKeep = [WL_ROLE_ID];
  const rolesToRemove = member.roles.cache.filter(r => !rolesToKeep.includes(r.id) && r.id !== guild.id);
  if (rolesToRemove.size > 0) {
    await member.roles.remove(rolesToRemove, reason || 'Punishment: security violation');
  }
  punishedUsers.add(member.id);
  return rolesToRemove;
}

async function logPunishment(guild, user, actionDetail, rolesRemoved, reason) {
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setTitle('🚨 Security Violation – Punishment Applied')
    .setColor(0xFF0000)
    .setDescription(`**User:** ${user.tag} (${user.id})`)
    .addFields(
      { name: 'Action', value: actionDetail, inline: true },
      { name: 'Roles Removed', value: `${rolesRemoved.size} role(s)`, inline: true },
      { name: 'Remaining Roles', value: `<@&${WL_ROLE_ID}> only` },
      { name: 'Reason', value: reason || 'No further details' }
    )
    .setTimestamp()
    .setFooter({ text: 'Auto Security Log' });
  await logChannel.send({ embeds: [embed] });
}

// General (non-punishment) activity log — messages deleted, joins/leaves,
// role changes, etc. Posts to the same LOG_CHANNEL_ID with its own color
// per event type so it's easy to visually tell apart from security actions.
async function logEvent(guild, title, description, color = 0x5865F2) {
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(description)
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(err => console.error('Failed to send log event:', err));
}

// If an audit-log lookup fails (most commonly: bot is missing the
// "View Audit Log" permission), report it instead of silently swallowing it,
// so a punishment that should have happened doesn't just vanish with no trace.
async function reportAuditFailure(guild, context, err) {
  console.error(`Audit log lookup failed (${context}):`, err);
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Security Check Failed')
    .setColor(0xFFFF00)
    .setDescription(
      `Could not check the audit log for **${context}**, so no action was taken.\n` +
      `**Likely cause:** the bot is missing the **View Audit Log** permission.\n` +
      `**Error:** \`${err.message || err}\``
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

// Generic "is this executor doing X too often" tracker.
function trackAction(tracker, executorId, windowMs, threshold) {
  const now = Date.now();
  if (!tracker.has(executorId)) tracker.set(executorId, []);
  const timestamps = tracker.get(executorId);
  timestamps.push(now);
  const valid = timestamps.filter(ts => now - ts < windowMs);
  tracker.set(executorId, valid);
  return valid.length > threshold;
}

function trackRoleRemoval(executorId) {
  return trackAction(roleRemovalTracker, executorId, REMOVAL_WINDOW_MS, REMOVAL_THRESHOLD);
}

function trackBan(executorId) {
  return trackAction(banTracker, executorId, BAN_WINDOW_MS, BAN_THRESHOLD);
}

// Fetch the most recent matching audit log entry and return it only if
// it's fresh enough and actually points at the event we just received.
async function getFreshAuditEntry(guild, type) {
  const auditLogs = await guild.fetchAuditLogs({ type, limit: 1 });
  const entry = auditLogs.entries.first();
  if (!entry) return null;
  if (Date.now() - entry.createdTimestamp > AUDIT_LOG_FRESHNESS_MS) return null;
  return entry;
}

// ─── Build whitelist embed ────────────────────────────────────────
function buildEmbed() {
  return new EmbedBuilder()
    .setTitle('STRZ Whitelist')
    .setDescription('To get whitelisted, simply type **wl** in this channel.\n\n> Make sure you follow the rules.')
    .setColor(0xFF0000)
    .setImage(EMBED_IMAGE)
    .setThumbnail(EMBED_THUMBNAIL)
    .setFooter({ text: 'STRZ WHITELIST', iconURL: EMBED_THUMBNAIL });
}

// ─── Build ticket panel ───────────────────────────────────────────
function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setTitle('STRZ TICKETS')
    .setDescription(
      'Select the type of ticket you would like to open from the dropdown below.\n\n' +
      '• **General Support** – Get help with general issues\n' +
      '• **Ban Appeal** – Appeal a server ban\n' +
      '• **Staff Report** – Report a staff member\n' +
      '• **Report Ticket** – Report a problem with a ticket\n' +
      '• **Donations** – Donation inquiries and support'
    )
    .setColor(0xFF0000)
    .setImage(EMBED_IMAGE)
    .setTimestamp();

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('Choose a ticket type...')
    .addOptions(TICKET_OPTIONS.map(opt => ({
      label: opt.label,
      value: opt.value,
      description: opt.description,
    })));

  const row = new ActionRowBuilder().addComponents(selectMenu);
  return { embed, row };
}

// ─── Build application panel ──────────────────────────────────────
function buildAppPanel() {
  const embed = new EmbedBuilder()
    .setTitle('STRZ Staff Applications')
    .setDescription('Click the button below to apply for staff on our FiveM RP/PVP server.\n\nYou will be asked 10 questions via DM. Make sure your DMs are open!')
    .setColor(0xFF0000)
    .setImage(EMBED_IMAGE)
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId('staff_apply')
    .setLabel('Apply Now')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);
  return { embed, row };
}

// ─── Send / refresh ticket panel ──────────────────────────────────
async function sendTicketPanel(channel) {
  try {
    if (ticketPanelMessage) await ticketPanelMessage.delete().catch(() => {});
    const { embed, row } = buildTicketPanel();
    ticketPanelMessage = await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Ticket panel sent.');
  } catch (err) {
    console.error('❌ Failed to send ticket panel:', err);
  }
}

// ─── Send application panel ───────────────────────────────────────
async function sendAppPanel(channel) {
  try {
    const { embed, row } = buildAppPanel();
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Application panel sent.');
  } catch (err) {
    console.error('❌ Failed to send application panel:', err);
  }
}

// ─── Transcript function ─────────────────────────────────────────
async function generateTranscript(channel, closer) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const messageMap = new Map();
  messages.forEach(msg => {
    if (msg.author.bot) return;
    if (!messageMap.has(msg.author.id)) messageMap.set(msg.author.id, { user: msg.author, count: 0 });
    messageMap.get(msg.author.id).count++;
  });

  const transcriptEmbed = new EmbedBuilder()
    .setTitle('🎫 Ticket Closed')
    .setColor(0xFF0000)
    .setDescription(`**Ticket:** ${channel.name}\n**Closed by:** ${closer.tag} (${closer.id})`)
    .addFields(
      { name: 'Message Activity', value: messageMap.size > 0
        ? [...messageMap.entries()].map(([id, data]) => `<@${id}>: ${data.count} messages`).join('\n')
        : 'No messages (only bots)' }
    )
    .setTimestamp()
    .setFooter({ text: 'Ticket Transcript' });

  return transcriptEmbed;
}

// ─── Handle ticket creation ───────────────────────────────────────
async function handleTicketInteraction(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticket_select') return;
  await interaction.deferReply({ ephemeral: true });

  const selectedValue = interaction.values[0];
  const categoryId = TICKET_CATEGORIES[selectedValue];
  if (!categoryId) return interaction.editReply('Invalid selection.');

  const guild = interaction.guild;
  const member = interaction.member;

  try {
    const channelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
        { id: SUPPORT_TEAM_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ],
    });

    await ticketChannel.send(`Welcome ${interaction.user}! A staff member will be with you shortly.\nType \`!close\` to close this ticket.\nUse \`!add @user\` to add someone to this ticket.`);

    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('🎫 Ticket Created')
        .setColor(0x00FF00)
        .setDescription(`**User:** ${interaction.user.tag}\n**Type:** ${selectedValue}\n**Channel:** ${ticketChannel}`)
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }

    await interaction.editReply({ content: `Your ticket has been created: ${ticketChannel}`, ephemeral: true });
  } catch (err) {
    console.error('Error creating ticket:', err);
    await interaction.editReply({ content: '❌ Failed to create ticket.', ephemeral: true });
  }
}

// ─── Handle staff application button ──────────────────────────────
async function handleAppButton(interaction) {
  if (interaction.customId !== 'staff_apply') return;
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.user;
  if (pendingApplications.has(user.id)) {
    return interaction.editReply('You already have an active application. Please complete it first.');
  }

  try {
    await user.send('**Staff Application – Question 1/10**\n' + STAFF_QUESTIONS[0]);
    pendingApplications.set(user.id, { step: 0, answers: [], author: user });
    await interaction.editReply('I have sent you the first question via DM! Please check your DMs.');
  } catch (err) {
    console.error('Could not DM user:', err);
    await interaction.editReply('❌ I could not send you a DM. Please enable DMs from server members and try again.');
  }
}

// ─── Handle accept/deny buttons ───────────────────────────────────
async function handleAppDecision(interaction) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'app_accept' && interaction.customId !== 'app_deny') return;

  const msgId = interaction.message.id;
  const appData = appMessagesMap.get(msgId);
  if (!appData) {
    return interaction.reply({ content: 'This application has already been processed.', ephemeral: true });
  }

  const { userId, embed, row } = appData;
  const applicant = await client.users.fetch(userId).catch(() => null);
  if (!applicant) {
    return interaction.reply({ content: 'Could not fetch applicant.', ephemeral: true });
  }

  // Disable buttons
  const newRow = ActionRowBuilder.from(row);
  newRow.components.forEach(btn => btn.setDisabled(true));
  await interaction.message.edit({ components: [newRow] });
  appMessagesMap.delete(msgId);

  const resultChannel = client.channels.cache.get(APP_RESULT_CHANNEL_ID);
  if (!resultChannel) return console.error('❌ Result channel not found');

  if (interaction.customId === 'app_accept') {
    const acceptEmbed = new EmbedBuilder()
      .setTitle('✅ Application Accepted')
      .setColor(0x00FF00)
      .setDescription(`Your application has been accepted! <:strz:1523654478711226429>\n\n${applicant} please open a <#${TICKET_CHANNEL_ID}> and @ a member of our staff team!`)
      .setTimestamp()
      .setFooter({ text: `Accepted by ${interaction.user.tag}` });

    await resultChannel.send({ content: `${applicant}`, embeds: [acceptEmbed] });
    await applicant.send('🎉 Congratulations! Your staff application has been accepted. Please open a ticket in the server to proceed.').catch(() => {});
  } else {
    const denyEmbed = new EmbedBuilder()
      .setTitle('❌ Application Denied')
      .setColor(0xFF0000)
      .setDescription(`Sorry but at this moment in time you have been denied.\n\n${applicant} feel free to apply again in 2 days!`)
      .setTimestamp()
      .setFooter({ text: `Denied by ${interaction.user.tag}` });

    await resultChannel.send({ content: `${applicant}`, embeds: [denyEmbed] });
    await applicant.send('Your staff application has been denied. You may reapply in 2 days.').catch(() => {});
  }

  // Update log embed to show processed
  const processedEmbed = EmbedBuilder.from(embed)
    .setFooter({ text: `Processed by ${interaction.user.tag}` });
  await interaction.message.edit({ embeds: [processedEmbed], components: [newRow] });

  await interaction.reply({ content: 'Application processed successfully.', ephemeral: true });
}

// ─── Send whitelist embed ─────────────────────────────────────────
async function sendEmbed() {
  const channel = client.channels.cache.get(WL_CHANNEL_ID);
  if (!channel) return console.error(`❌ WL channel ${WL_CHANNEL_ID} not found.`);
  try {
    embedMessage = await channel.send({ embeds: [buildEmbed()] });
    console.log('✅ Whitelist embed sent.');
  } catch (err) {
    console.error('❌ Failed to send embed:', err);
  }
}

async function refreshEmbed() {
  if (embedMessage) {
    try { await embedMessage.delete(); } catch (err) { console.error('Failed to delete old embed:', err); }
    embedMessage = null;
  }
  await sendEmbed();
}

// ─── SECURITY: role deleted ────────────────────────────────────────
client.on('roleDelete', async (role) => {
  const guild = role.guild;
  let entry;
  try {
    entry = await getFreshAuditEntry(guild, AuditLogEvent.RoleDelete);
  } catch (err) {
    return reportAuditFailure(guild, `role deletion (#${role.name})`, err);
  }
  try {
    if (!entry || !entry.executor) return;
    if (entry.executor.id === client.user.id) return; // ignore the bot's own actions

    const member = await guild.members.fetch(entry.executor.id).catch(() => null);
    if (!member) return;
    if (member.roles.cache.has(AUTHORISED_ROLE_ID)) return; // authorised staff are allowed

    const rolesRemoved = await applyPunishment(member, 'Deleted a server role', guild);
    await logPunishment(guild, member.user, `Deleted role: ${role.name}`, rolesRemoved, 'Unauthorized role deletion');
  } catch (err) {
    console.error('Error handling roleDelete:', err);
  }
});

// ─── SECURITY: channel deleted ─────────────────────────────────────
client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const guild = channel.guild;
  let entry;
  try {
    entry = await getFreshAuditEntry(guild, AuditLogEvent.ChannelDelete);
  } catch (err) {
    return reportAuditFailure(guild, `channel deletion (#${channel.name})`, err);
  }
  try {
    if (!entry || !entry.executor) return;
    if (entry.executor.id === client.user.id) return;

    const member = await guild.members.fetch(entry.executor.id).catch(() => null);
    if (!member) return;
    if (member.roles.cache.has(AUTHORISED_ROLE_ID)) return;

    const rolesRemoved = await applyPunishment(member, 'Deleted a server channel', guild);
    await logPunishment(guild, member.user, `Deleted channel: #${channel.name}`, rolesRemoved, 'Unauthorized channel deletion');
  } catch (err) {
    console.error('Error handling channelDelete:', err);
  }
});

// ─── SECURITY: mass banning (more than 1 ban within 30 seconds) ───
client.on('guildBanAdd', async (ban) => {
  const guild = ban.guild;
  let entry;
  try {
    entry = await getFreshAuditEntry(guild, AuditLogEvent.MemberBanAdd);
  } catch (err) {
    return reportAuditFailure(guild, 'member ban', err);
  }
  try {
    if (!entry || !entry.executor) return;
    if (entry.executor.id === client.user.id) return;

    const member = await guild.members.fetch(entry.executor.id).catch(() => null);
    if (!member) return;
    if (member.roles.cache.has(AUTHORISED_ROLE_ID)) return;

    const isMassBanning = trackBan(entry.executor.id);
    if (isMassBanning) {
      const rolesRemoved = await applyPunishment(member, 'Mass banning members', guild);
      await logPunishment(guild, member.user, 'Mass ban detected (more than 1 ban in 30s)', rolesRemoved, 'Unauthorized mass banning');
    }
  } catch (err) {
    console.error('Error handling guildBanAdd:', err);
  }
});

// ─── SECURITY: mass role removal (more than 3 members in 5 min) ──
// ─── + GENERAL LOG: every role add/remove ─────────────────────────
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const guild = newMember.guild;
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  if (removedRoles.size === 0 && addedRoles.size === 0) return; // nothing role-related changed

  let entry;
  try {
    entry = await getFreshAuditEntry(guild, AuditLogEvent.MemberRoleUpdate);
  } catch (err) {
    return reportAuditFailure(guild, `role update for ${newMember.user.tag}`, err);
  }

  const executorTag = (entry && entry.executor && entry.target?.id === newMember.id)
    ? `${entry.executor.tag} (${entry.executor.id})`
    : 'Unknown';

  // General activity log for any role change, regardless of threshold.
  try {
    if (addedRoles.size > 0) {
      await logEvent(
        guild,
        '➕ Role(s) Added',
        `**Member:** ${newMember.user.tag} (${newMember.id})\n**Roles:** ${addedRoles.map(r => r.name).join(', ')}\n**By:** ${executorTag}`,
        0x00B0F4
      );
    }
    if (removedRoles.size > 0) {
      await logEvent(
        guild,
        '➖ Role(s) Removed',
        `**Member:** ${newMember.user.tag} (${newMember.id})\n**Roles:** ${removedRoles.map(r => r.name).join(', ')}\n**By:** ${executorTag}`,
        0xFFA500
      );
    }
  } catch (err) {
    console.error('Error logging role change:', err);
  }

  // Role lock: punished users cannot keep any role added to them unless
  // the person/bot granting it has PUNISHMENT_OVERRIDE_ROLE_ID.
  try {
    if (addedRoles.size > 0 && punishedUsers.has(newMember.id)) {
      let executorMember = null;
      if (entry && entry.executor && entry.target?.id === newMember.id) {
        executorMember = await guild.members.fetch(entry.executor.id).catch(() => null);
      }
      const executorHasOverride = executorMember?.roles.cache.has(PUNISHMENT_OVERRIDE_ROLE_ID);

      if (!executorHasOverride) {
        await newMember.roles.remove(addedRoles, 'Punished user — role re-added without override authorization, stripped again');
        await logPunishment(
          guild,
          newMember.user,
          `Blocked re-added role(s): ${addedRoles.map(r => r.name).join(', ')}`,
          addedRoles,
          `Granted by ${executorTag}, who lacks the punishment override role. Roles stripped again instantly.`
        );
      }
    }
  } catch (err) {
    console.error('Error enforcing punished-user role lock:', err);
  }

  // Punishment check (removals only).
  try {
    if (removedRoles.size === 0) return;
    if (!entry || !entry.executor) return;
    if (entry.target?.id !== newMember.id) return; // make sure the log entry matches this member
    if (entry.executor.id === client.user.id) return; // ignore the bot's own punishment actions

    const executorMember = await guild.members.fetch(entry.executor.id).catch(() => null);
    if (!executorMember) return;
    if (executorMember.roles.cache.has(AUTHORISED_ROLE_ID)) return;

    const isMassRemoving = trackRoleRemoval(entry.executor.id);
    if (isMassRemoving) {
      const rolesRemoved = await applyPunishment(executorMember, 'Mass removing roles from members', guild);
      await logPunishment(guild, executorMember.user, 'Mass role removal detected (more than 3 members in 5 min)', rolesRemoved, 'Unauthorized mass role removal');
    }
  } catch (err) {
    console.error('Error handling guildMemberUpdate punishment check:', err);
  }
});

// ─── GENERAL LOG: message deleted ─────────────────────────────────
client.on('messageDelete', async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.id === client.user.id) return; // don't log the bot's own panel refreshes

    let executorTag = 'Self-deleted (or no audit log entry found)';
    try {
      const entry = await getFreshAuditEntry(message.guild, AuditLogEvent.MessageDelete);
      if (entry && (!message.author || entry.target?.id === message.author.id)) {
        executorTag = `${entry.executor.tag} (${entry.executor.id})`;
      }
    } catch (err) {
      console.error('Audit log lookup failed for messageDelete:', err);
    }

    // If the message wasn't cached (message.partial), we won't have author/
    // content — still log the deletion itself rather than skipping it.
    const authorLine = message.author
      ? `${message.author.tag} (${message.author.id})`
      : `Unknown (message wasn't cached — id: ${message.id})`;

    const content = message.partial
      ? '*Not available (message was not cached before deletion)*'
      : (message.content && message.content.length > 0
        ? message.content.slice(0, 500)
        : '*No text content (embed, attachment, or empty message)*');

    await logEvent(
      message.guild,
      '🗑️ Message Deleted',
      `**Author:** ${authorLine}\n**Channel:** ${message.channel}\n**Deleted by:** ${executorTag}\n**Content:**\n${content}`,
      0xFF8C00
    );
  } catch (err) {
    console.error('Error handling messageDelete:', err);
  }
});

// ─── GENERAL LOG: member joined + SECURITY: unauthorized bot add ──
client.on('guildMemberAdd', async (member) => {
  const guild = member.guild;

  try {
    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    await logEvent(
      guild,
      '📥 Member Joined',
      `**User:** ${member.user.tag} (${member.id})\n**Account created:** ${accountAgeDays} day(s) ago${member.user.bot ? '\n**Type:** 🤖 Bot' : ''}`,
      0x00FF00
    );
  } catch (err) {
    console.error('Error handling guildMemberAdd:', err);
  }

  // Anti-bot-add: any bot added by someone who doesn't have the
  // punishment override role gets kicked instantly, and the person who
  // added it gets stripped too.
  if (!member.user.bot) return;

  let entry;
  try {
    entry = await getFreshAuditEntry(guild, AuditLogEvent.BotAdd);
  } catch (err) {
    return reportAuditFailure(guild, `bot add (${member.user.tag})`, err);
  }

  try {
    const executorMember = (entry && entry.executor && entry.target?.id === member.id)
      ? await guild.members.fetch(entry.executor.id).catch(() => null)
      : null;
    const executorTag = executorMember ? `${executorMember.user.tag} (${executorMember.id})` : 'Unknown';
    const authorized = executorMember?.roles.cache.has(PUNISHMENT_OVERRIDE_ROLE_ID);

    if (authorized) return; // added by someone with the override role — allowed

    // 1. Kick the bot instantly.
    await member.kick(`Unauthorized bot add by ${executorTag} (lacks override role)`)
      .catch(err => console.error('Failed to kick unauthorized bot:', err));

    // 2. Strip the person who added it (locked via punishedUsers so they
    //    can't get roles back except from the override role).
    let executorRolesRemoved = null;
    if (executorMember) {
      executorRolesRemoved = await applyPunishment(executorMember, 'Added an unauthorized bot to the server', guild);
    }

    // 3. Log both actions.
    await logPunishment(
      guild,
      member.user,
      'Unauthorized bot add — bot kicked',
      new Map(), // the bot itself had no roles removed, it was just kicked
      `Added by ${executorTag}, who lacks the punishment override role.`
    );
    if (executorMember && executorRolesRemoved) {
      await logPunishment(
        guild,
        executorMember.user,
        `Added unauthorized bot: ${member.user.tag}`,
        executorRolesRemoved,
        'Added a bot to the server without holding the punishment override role.'
      );
    }
  } catch (err) {
    console.error('Error handling unauthorized bot add:', err);
  }
});

// ─── GENERAL LOG: member left / kicked ────────────────────────────
client.on('guildMemberRemove', async (member) => {
  try {
    let action = 'Left';
    let executorTag = null;
    try {
      const entry = await getFreshAuditEntry(member.guild, AuditLogEvent.MemberKick);
      if (entry && entry.target?.id === member.id) {
        action = 'Kicked';
        executorTag = `${entry.executor.tag} (${entry.executor.id})`;
      }
    } catch (err) {
      console.error('Audit log lookup failed for guildMemberRemove:', err);
    }
    await logEvent(
      member.guild,
      `📤 Member ${action}`,
      `**User:** ${member.user.tag} (${member.id})${executorTag ? `\n**By:** ${executorTag}` : ''}`,
      0xFF4500
    );
  } catch (err) {
    console.error('Error handling guildMemberRemove:', err);
  }
});

// ─── Ready Event ──────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    const me = await guild.members.fetchMe().catch(() => null);
    if (!me) continue;

    // Warn loudly (console + log channel) if the bot can't see audit logs —
    // without this permission, punishment for role/channel deletion and mass
    // bans/role-removals silently cannot detect who did it.
    if (!me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
      console.warn(`⚠️ Missing "View Audit Log" permission in guild: ${guild.name} (${guild.id}). Security punishments will not work until this is granted.`);
      const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle('⚠️ Missing Permission: View Audit Log')
            .setColor(0xFFFF00)
            .setDescription('I don\'t have the **View Audit Log** permission in this server. Role deletion, channel deletion, mass ban, and mass role removal punishments will NOT work until I\'m given this permission.')
            .setTimestamp()],
        }).catch(() => {});
      }
    }

    // Separately check the log channel itself — if the bot can't view or
    // send messages there, EVERY log (security + general activity) fails
    // silently with no way to warn inside Discord, so this must go to console.
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) {
      console.warn(`⚠️ LOG_CHANNEL_ID (${LOG_CHANNEL_ID}) was not found in guild "${guild.name}". Check the ID is correct and the bot can see it.`);
    } else {
      const perms = logChannel.permissionsFor(me);
      const canView = perms?.has(PermissionsBitField.Flags.ViewChannel);
      const canSend = perms?.has(PermissionsBitField.Flags.SendMessages);
      const canEmbed = perms?.has(PermissionsBitField.Flags.EmbedLinks);
      if (!canView || !canSend || !canEmbed) {
        console.warn(
          `⚠️ Missing permissions in log channel #${logChannel.name} (guild "${guild.name}"): ` +
          `${!canView ? 'View Channel ' : ''}${!canSend ? 'Send Messages ' : ''}${!canEmbed ? 'Embed Links' : ''}` +
          ` — nothing will be logged there until this is fixed.`
        );
      }
    }
  }

  await sendEmbed();
  const ticketChannel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (ticketChannel) await sendTicketPanel(ticketChannel);

  const applyChannel = client.channels.cache.get(APPLY_CHANNEL_ID);
  if (applyChannel) await sendAppPanel(applyChannel);

  // Auto refresh every 30 minutes — ONLY the whitelist embed.
  // Ticket panel and staff application panel are sent once on startup
  // and are left alone after that.
  setInterval(async () => {
    await refreshEmbed();
  }, 30 * 60 * 1000);
});

// ─── Interaction handlers ─────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    await handleTicketInteraction(interaction);
  } else if (interaction.isButton()) {
    if (interaction.customId === 'staff_apply') {
      await handleAppButton(interaction);
    } else {
      await handleAppDecision(interaction);
    }
  }
});

// ─── SINGLE messageCreate handler (covers whitelist, tickets, DM applications) ──
client.on('messageCreate', async (message) => {
  // ── DM Handling for Staff Applications ──
  if (message.channel.type === ChannelType.DM && !message.author.bot) {
    const userId = message.author.id;
    const app = pendingApplications.get(userId);
    if (app) {
      const { step, answers } = app;
      answers.push(message.content);
      if (step + 1 < STAFF_QUESTIONS.length) {
        await message.author.send(`**Staff Application – Question ${step+2}/${STAFF_QUESTIONS.length}**\n${STAFF_QUESTIONS[step+1]}`);
        app.step++;
      } else {
        await message.author.send('✅ Thank you! Your application has been submitted for review.');
        pendingApplications.delete(userId);

        const embed = new EmbedBuilder()
          .setTitle('📋 New Staff Application')
          .setColor(0xFF0000)
          .setDescription(`**Applicant:** ${message.author.tag} (${message.author.id})`)
          .addFields(
            STAFF_QUESTIONS.map((q, i) => ({
              name: `Q${i+1}: ${q}`,
              value: answers[i] || 'No answer',
              inline: false,
            }))
          )
          .setTimestamp()
          .setFooter({ text: 'Staff Applications' });

        const acceptBtn = new ButtonBuilder()
          .setCustomId('app_accept')
          .setLabel('Accept')
          .setStyle(ButtonStyle.Success);
        const denyBtn = new ButtonBuilder()
          .setCustomId('app_deny')
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(acceptBtn, denyBtn);

        const logChannel = client.channels.cache.get(APP_LOG_CHANNEL_ID);
        if (logChannel) {
          const sentMsg = await logChannel.send({
            content: `<@&${SUPPORT_TEAM_ROLE_ID}>`,
            embeds: [embed],
            components: [row],
          });
          appMessagesMap.set(sentMsg.id, { userId, embed, row });
        }
      }
      return;
    }
  }

  // ── Guild Messages ──
  if (message.author.bot) return;

  // Whitelist channel
  if (message.channel.id === WL_CHANNEL_ID) {
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
        setTimeout(() => reply.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error('Error handling non‑wl message:', err);
      }
    }
    return;
  }

  // Ticket commands
  const isTicket = message.channel.parentId && Object.values(TICKET_CATEGORIES).includes(message.channel.parentId);
  if (isTicket) {
    const content = message.content.trim().toLowerCase();

    if (content === '!close') {
      try {
        const transcriptEmbed = await generateTranscript(message.channel, message.author);
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) await logChannel.send({ embeds: [transcriptEmbed] });

        await message.channel.send('🗑️ This ticket will be deleted in 5 seconds...');
        setTimeout(async () => {
          await message.channel.delete('Ticket closed by user').catch(() => {});
        }, 5000);
      } catch (err) {
        console.error('Error closing ticket:', err);
        await message.channel.send('❌ Failed to close ticket.');
      }
      return;
    }

    if (content.startsWith('!add ')) {
      const user = message.mentions.users.first();
      if (!user) {
        return message.reply('❌ Please mention a user, e.g. `!add @user`');
      }
      try {
        await message.channel.permissionOverwrites.create(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
        await message.channel.send(`✅ Added ${user} to this ticket.`);
      } catch (err) {
        console.error('Error adding user to ticket:', err);
        await message.reply('❌ Failed to add user. Check permissions.');
      }
      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
