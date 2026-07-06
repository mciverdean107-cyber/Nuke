const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  AuditLogEvent,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageComponents, // required for select menus
  ],
});

// ─── Channel / Role IDs ───────────────────────────────────────────
const WL_CHANNEL_ID = '1523391788914708580';
const WL_ROLE_ID = '1523391650867445972';
const LOG_CHANNEL_ID = '1523392065411747870';
const AUTHORISED_ROLE_ID = '1523391574296367194';
const TICKET_CHANNEL_ID = '1523391948260507700';

// ─── Category IDs for tickets ─────────────────────────────────────
const TICKET_CATEGORIES = {
  'general_support': '1523391671662940181',
  'ban_appeal': '1523391669058273432',
  'staff_report': '1523391670648049744',
  'report_ticket': '1523391672610853025',
  'donations': '1523391673604898947',
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
const roleRemovalTracker = new Map();
const REMOVAL_THRESHOLD = 2;
const REMOVAL_WINDOW_MS = 5 * 60 * 1000;

// ─── Embeds ───────────────────────────────────────────────────────
const EMBED_TITLE = 'STRZ Whitelist';
const EMBED_DESCRIPTION = 'To get whitelisted, simply type **wl** in this channel.\n\n> Make sure you follow the rules.';
const EMBED_IMAGE = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400667320815822/Screenshot_20260705_171214_Discord.jpg?ex=6a4ca1ae&is=6a4b502e&hm=036363d063bc9ba28f14d4485d3330e6a79d8e5c29bcbd9246354d4443978309&';
const EMBED_THUMBNAIL = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400669128556797/Untitled104_20260705142221.png?ex=6a4ca1ae&is=6a4b502e&hm=ed7cde8b7a896175d7d48f2750f3f0bc12e5f40ed6410d520fca612c69888804&';
const EMBED_FOOTER_TEXT = 'STRZ WHITELIST';
const EMBED_FOOTER_ICON = 'https://cdn.discordapp.com/attachments/1517133194477047808/1523400669128556797/Untitled104_20260705142221.png?ex=6a4ca1ae&is=6a4b502e&hm=ed7cde8b7a896175d7d48f2750f3f0bc12e5f40ed6410d520fca612c69888804&';

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

function trackRoleRemoval(executorId) {
  const now = Date.now();
  if (!roleRemovalTracker.has(executorId)) roleRemovalTracker.set(executorId, []);
  const timestamps = roleRemovalTracker.get(executorId);
  timestamps.push(now);
  const valid = timestamps.filter(ts => now - ts < REMOVAL_WINDOW_MS);
  roleRemovalTracker.set(executorId, valid);
  return valid.length > REMOVAL_THRESHOLD;
}

// ─── Build whitelist embed ────────────────────────────────────────
function buildEmbed() {
  return new EmbedBuilder()
    .setTitle(EMBED_TITLE)
    .setDescription(EMBED_DESCRIPTION)
    .setColor(0xFF0000)
    .setImage(EMBED_IMAGE)
    .setThumbnail(EMBED_THUMBNAIL)
    .setFooter({ text: EMBED_FOOTER_TEXT, iconURL: EMBED_FOOTER_ICON });
}

// ─── Build ticket panel embed + action row ────────────────────────
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
    .setImage(EMBED_IMAGE) // same large image as WL embed
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

// ─── Send / refresh ticket panel ──────────────────────────────────
async function sendTicketPanel(channel) {
  try {
    // Delete old panel if exists
    if (ticketPanelMessage) {
      await ticketPanelMessage.delete().catch(() => {});
    }
    const { embed, row } = buildTicketPanel();
    ticketPanelMessage = await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Ticket panel sent.');
  } catch (err) {
    console.error('❌ Failed to send ticket panel:', err);
  }
}

// ─── Handle ticket creation ───────────────────────────────────────
async function handleTicketInteraction(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'ticket_select') return;

  await interaction.deferReply({ ephemeral: true });

  const selectedValue = interaction.values[0];
  const categoryId = TICKET_CATEGORIES[selectedValue];
  if (!categoryId) {
    return interaction.editReply('Invalid selection.');
  }

  const guild = interaction.guild;
  const member = interaction.member;

  // Create a new private channel under the selected category
  try {
    const channelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
          ],
        },
      ],
    });

    // Send welcome message
    await ticketChannel.send({
      content: `Welcome ${interaction.user}! A staff member will be with you shortly.\nType \`!close\` to close this ticket.`,
    });

    // Log ticket creation in log channel
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('🎫 Ticket Created')
        .setColor(0x00FF00)
        .setDescription(`**User:** ${interaction.user.tag}\n**Type:** ${interaction.values[0]}\n**Channel:** ${ticketChannel}`)
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }

    await interaction.editReply({ content: `Your ticket has been created: ${ticketChannel}`, ephemeral: true });
  } catch (err) {
    console.error('Error creating ticket:', err);
    await interaction.editReply({ content: '❌ Failed to create ticket. Please try again or contact an admin.', ephemeral: true });
  }
}

// ─── Send whitelist embed ─────────────────────────────────────────
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

// ─── Ready Event ──────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Send / refresh both panels
  await sendEmbed();
  const ticketChannel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (ticketChannel) {
    await sendTicketPanel(ticketChannel);
  } else {
    console.error(`❌ Ticket channel ${TICKET_CHANNEL_ID} not found.`);
  }

  // Auto refresh both every 30 minutes
  setInterval(async () => {
    await refreshEmbed();
    const ticketChan = client.channels.cache.get(TICKET_CHANNEL_ID);
    if (ticketChan) await sendTicketPanel(ticketChan);
  }, 30 * 60 * 1000);

  // ─── Security listeners ─────────────────────────────────────
  client.on('roleDelete', async (role) => {
    const guild = role.guild;
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
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

  client.on('channelDelete', async (channel) => {
    const guild = channel.guild;
    if (!guild) return;
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
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

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Role removal detection for mass removal
    const removedRoles = oldMember.roles.cache.filter(
      (role, id) => !newMember.roles.cache.has(id) && role.id !== newMember.guild.id
    );
    if (removedRoles.size === 0) return;

    try {
      const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 });
      const entry = auditLogs.entries.find(
        e => e.target.id === newMember.id && e.changes?.some(c => c.key === '$remove' && removedRoles.has(c.new_value?.id))
      );
      if (!entry) return;
      const executor = entry.executor;
      if (!executor) return;
      const executorMember = newMember.guild.members.cache.get(executor.id) || await newMember.guild.members.fetch(executor.id).catch(() => null);
      if (!executorMember) return;

      const thresholdExceeded = trackRoleRemoval(executor.id);
      if (thresholdExceeded) {
        const rolesRemovedFromExecutor = await applyPunishment(executorMember, 'Removed roles from >2 members in 5 minutes', newMember.guild);
        await logPunishment(newMember.guild, executor,
          'Removed roles from multiple members (exceeded threshold)',
          rolesRemovedFromExecutor,
          'Mass role removal detected'
        );
        roleRemovalTracker.delete(executor.id);
      }
    } catch (err) {
      console.error('Error checking role removal threshold:', err);
    }

    // Role addition prevention for punished users
    if (!punishedUsers.has(newMember.id)) return;
    const addedRoles = newMember.roles.cache.filter(
      (role, id) => !oldMember.roles.cache.has(id) && role.id !== WL_ROLE_ID && role.id !== newMember.guild.id
    );
    if (addedRoles.size === 0) return;

    try {
      const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 });
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
});

// ─── Interaction handler for ticket menu ──────────────────────────
client.on('interactionCreate', handleTicketInteraction);

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
      setTimeout(() => { reply.delete().catch(() => {}); }, 5000);
    } catch (err) {
      console.error('Error handling non‑wl message:', err);
    }
  }
});

// ─── Optional: close ticket command ───────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() === '!close' && message.channel.parentId && Object.values(TICKET_CATEGORIES).includes(message.channel.parentId)) {
    try {
      await message.channel.delete('Ticket closed by user');
    } catch (err) {
      console.error('Error closing ticket:', err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
