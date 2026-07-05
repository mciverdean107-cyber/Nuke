const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX = '!';

// ─── CONFIG ─────────────────────────────────────────────────────────
const TICKET_PANEL_CHANNEL_ID = '1523330329329537044';
const MAIN_PANEL_COLOUR = 0x8B0000; // dark red

const FOOTER_ICON_URL =
  'https://cdn.discordapp.com/attachments/1517133194477047808/1523355310721335376/Untitled104_20260705142221.png';
const MAIN_IMAGE_URL =
  'https://cdn.discordapp.com/attachments/1517133194477047808/1523355292182773770/Untitled106_20260705154421.png';

const SUPPORT_ROLE_IDS = [
  '1523329668210757682',
  '1523329671016611861',
  '1523329672560119938',
  '1523329673315221564',
  '1523329676385452222',
  '1523329677232574494',
  '1523329677882818711',
  '1523329679510081677',
  '1523329681338929425',
  '1523329682202820618',
  '1523329683083628644',
];

// key -> { label, description, emoji, categoryId }
const TICKET_TYPES = {
  support: {
    label: 'Support',
    description: 'General help, character creation, bugs, connection issues',
    emoji: '🛠️',
    categoryId: '1523329887388041216',
  },
  purchase: {
    label: 'Purchase',
    description: 'Missing items, rank not given, store/donation problems',
    emoji: '💳',
    categoryId: '1523329901673840731', // Donations
  },
  report: {
    label: 'Report',
    description: 'Report a player (RDM, VDM, toxicity, metagaming, etc.)',
    emoji: '🚨',
    categoryId: '1523329893285232861', // Player Report
  },
  cheaterreport: {
    label: 'Cheater Report',
    description: 'Report a player for cheating/hacking (include proof)',
    emoji: '🎯',
    categoryId: '1523329888981876768', // Cheater Report
  },
  staffreport: {
    label: 'Staff Report',
    description: 'Report a staff member for abuse or bias (proof required)',
    emoji: '⚠️',
    categoryId: '1523329893285232861', // no dedicated ID given — using Player Report as fallback
  },
  banappeal: {
    label: 'Ban Appeal',
    description: 'Appeal a ban or warning — explain your side clearly',
    emoji: '📄',
    categoryId: '1523329888420106362',
  },
  gangimport: {
    label: 'Gang Import',
    description: 'Submit a gang import request',
    emoji: '🏴',
    categoryId: '1523329902474956871',
  },
  femaleverification: {
    label: 'Female Verification',
    description: 'Verify for the female role',
    emoji: '✅',
    categoryId: '1523329908842041465',
  },
};

// ─── Helper: check bot permissions ─────────────────────────────────
function getMissingPerms(guild, requiredPerms) {
  const botMember = guild.members.me;
  if (!botMember) return requiredPerms;
  const botPerms = botMember.permissions;
  return requiredPerms.filter(perm => !botPerms.has(perm));
}

function checkPermsAndReply(message, requiredPerms) {
  const missing = getMissingPerms(message.guild, requiredPerms);
  if (missing.length > 0) {
    const permNames = missing.map(p => `\`${p}\``).join(', ');
    message.reply(`❌ I am missing the following permissions:\n${permNames}\nPlease grant them and try again.`);
    return false;
  }
  return true;
}

function isSupportMember(member) {
  return SUPPORT_ROLE_IDS.some(id => member.roles.cache.has(id));
}

// ─── Build the ticket panel embed + dropdown ───────────────────────
function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setTitle('STRZ | Ticket System')
    .setColor(MAIN_PANEL_COLOUR)
    .setDescription(
      '**read carefully and dont spam @ staff luh twin**\n\n' +
      '**Support** — General help, stuck in character creation, game bugs, connection issues\n' +
      '**Purchase** — Missing items after payment, rank not given, store/donation problems\n' +
      '**Report** — Report players for RDM, VDM, toxicity, metagaming, rule breaking (include proof)\n' +
      '**Staff Report** — Report staff for abuse, bias, or breaking rules (proof required)\n' +
      '**Ban Appeal** — Appeal a ban or warning — explain your side clearly\n\n' +
      '**if u open the wrong ticket type shi get closed.**'
    )
    .setImage(MAIN_IMAGE_URL)
    .setFooter({ text: 'STRZ • Ticket Panel', iconURL: FOOTER_ICON_URL });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_select')
      .setPlaceholder('select the the category u need — make sure dat mf correct twin')
      .addOptions(
        Object.entries(TICKET_TYPES).map(([key, t]) => ({
          label: t.label,
          description: t.description,
          value: key,
          emoji: t.emoji,
        }))
      )
  );

  return { embeds: [embed], components: [row] };
}

// ─── Build a ticket's welcome embed + close button ─────────────────
function buildTicketMessage(ticketType, opener) {
  const t = TICKET_TYPES[ticketType];
  const embed = new EmbedBuilder()
    .setTitle(`STRZ | ${t.label} Ticket`)
    .setColor(MAIN_PANEL_COLOUR)
    .setDescription(
      `Hey ${opener}, thanks for opening a **${t.label}** ticket.\n\n` +
      `Please explain your issue in as much detail as possible. Staff will be with you shortly.\n\n` +
      `**if this is the wrong ticket type it will be closed.**`
    )
    .setFooter({ text: 'STRZ • Ticket Panel', iconURL: FOOTER_ICON_URL })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

// ─── Ready ─────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ─── Message Commands ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // ─── PANEL ─────────────────────────────────────────────────────
  // Usage: !panel
  // Sends the ticket panel to the configured ticket channel.
  if (command === 'panel') {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    if (!isSupportMember(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You do not have permission to use this command.');
    }

    const requiredPerms = [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    const panelChannel = message.guild.channels.cache.get(TICKET_PANEL_CHANNEL_ID);
    if (!panelChannel) return message.reply('❌ Could not find the configured ticket panel channel.');

    try {
      await panelChannel.send(buildTicketPanel());
      await message.reply(`✅ Ticket panel sent to <#${TICKET_PANEL_CHANNEL_ID}>.`);
    } catch (err) {
      console.error('Failed to send ticket panel:', err);
      await message.reply('❌ Failed to send the ticket panel. Check my permissions in that channel.');
    }
  }
});

// ─── Interaction Handling (select menu + buttons) ───────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;

  // ── Ticket type selected ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    const ticketType = interaction.values[0];
    const config = TICKET_TYPES[ticketType];
    if (!config) return interaction.reply({ content: '❌ Unknown ticket type.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const category = guild.channels.cache.get(config.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.editReply('❌ That ticket category no longer exists. Please contact an admin.');
    }

    // Prevent duplicate open tickets of the same type by the same user
    const existing = guild.channels.cache.find(
      ch => ch.parentId === category.id && ch.topic === `ticket-owner:${interaction.user.id}`
    );
    if (existing) {
      return interaction.editReply(`❌ You already have an open **${config.label}** ticket: <#${existing.id}>`);
    }

    const everyoneRole = guild.roles.everyone;

    const permissionOverwrites = [
      {
        id: everyoneRole.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
        ],
      },
      ...SUPPORT_ROLE_IDS.map(roleId => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles,
        ],
      })),
    ];

    try {
      const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
      const ticketChannel = await guild.channels.create({
        name: `${config.label.toLowerCase().replace(/\s+/g, '-')}-${safeName}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `ticket-owner:${interaction.user.id}`,
        permissionOverwrites,
      });

      await ticketChannel.send(buildTicketMessage(ticketType, interaction.user));

      await interaction.editReply(`✅ Your **${config.label}** ticket has been created: <#${ticketChannel.id}>`);
    } catch (err) {
      console.error('Failed to create ticket channel:', err);
      await interaction.editReply('❌ Failed to create your ticket. Please contact an admin.');
    }
  }

  // ── Close ticket button ──
  if (interaction.isButton() && interaction.customId === 'ticket_close') {
    const channel = interaction.channel;
    const isOwner = channel.topic === `ticket-owner:${interaction.user.id}`;
    const isStaff = isSupportMember(interaction.member);

    if (!isOwner && !isStaff) {
      return interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
    }

    await interaction.reply('🔒 This ticket will be closed in 5 seconds...');
    setTimeout(() => {
      channel.delete().catch(err => console.error('Failed to delete ticket channel:', err));
    }, 5000);
  }
});

// ─── Login ─────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
