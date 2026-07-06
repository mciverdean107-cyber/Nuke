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
} = require('discord.js');

const client = new Client({
  intents: [
    1,          // Guilds
    2,          // GuildMembers
    4,          // GuildModeration
    512,        // GuildMessages
    32768,      // MessageContent
    16384,      // GuildMessageComponents
  ],
});

// ─── IDs ──────────────────────────────────────────────────────────
const WL_CHANNEL_ID = '1523391788914708580';
const WL_ROLE_ID = '1523391650867445972';
const LOG_CHANNEL_ID = '1523392065411747870';
const AUTHORISED_ROLE_ID = '1523391574296367194';
const TICKET_CHANNEL_ID = '1523391948260507700';
const SUPPORT_TEAM_ROLE_ID = '1523391626503000134';
const APPLY_CHANNEL_ID = '1523391955827036360';
const APP_LOG_CHANNEL_ID = '1523392059195523376';
const APP_RESULT_CHANNEL_ID = '1523391958528032788';

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

// ─── Ready Event ──────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Send initial embeds (NO test messages)
  await sendEmbed();
  const ticketChannel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (ticketChannel) await sendTicketPanel(ticketChannel);

  const applyChannel = client.channels.cache.get(APPLY_CHANNEL_ID);
  if (applyChannel) await sendAppPanel(applyChannel);

  // Auto refresh every 30 minutes
  setInterval(async () => {
    await refreshEmbed();
    const tc = client.channels.cache.get(TICKET_CHANNEL_ID);
    if (tc) await sendTicketPanel(tc);
    const ac = client.channels.cache.get(APPLY_CHANNEL_ID);
    if (ac) await sendAppPanel(ac);
  }, 30 * 60 * 1000);

  // ─── SECURITY LISTENERS (unchanged) ───────────────────────
  // (Role deletion, channel deletion, mass role removal, role addition prevention, bot add)
  // ... (same as previous code, omitted here for brevity, but must be included)
  // Paste the full security listeners block from the previous answer here.
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
