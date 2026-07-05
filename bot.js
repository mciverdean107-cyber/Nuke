const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ─── Ready & Slash Command Registration ─────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await client.application.commands.set([
      new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Send a custom embed to the current channel')
        .addStringOption(option =>
          option.setName('color')
            .setDescription('Embed color (e.g. #ff0000, blue, random)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Embed title')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Embed description')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('image')
            .setDescription('Large image URL')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('thumbnail')
            .setDescription('Thumbnail image URL (top right)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('footer')
            .setDescription('Footer text')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('footer_icon')
            .setDescription('Footer icon URL (requires footer)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('author')
            .setDescription('Author name')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('author_icon')
            .setDescription('Author icon URL (requires author)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('author_url')
            .setDescription('Author link URL (requires author)')
            .setRequired(false))
        .addBooleanOption(option =>
          option.setName('timestamp')
            .setDescription('Add current timestamp')
            .setRequired(false))
    ]);
    console.log('✅ Global slash command /embed registered.');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
});

// ─── Interaction Handler ───────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'embed') return;

  const colorRaw = interaction.options.getString('color') || '#5865F2'; // default Discord blurple
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const image = interaction.options.getString('image');
  const thumbnail = interaction.options.getString('thumbnail');
  const footer = interaction.options.getString('footer');
  const footerIcon = interaction.options.getString('footer_icon');
  const author = interaction.options.getString('author');
  const authorIcon = interaction.options.getString('author_icon');
  const authorUrl = interaction.options.getString('author_url');
  const timestamp = interaction.options.getBoolean('timestamp') || false;

  // Convert color string to integer
  let colorInt;
  if (colorRaw.toLowerCase() === 'random') {
    colorInt = Math.floor(Math.random() * 0xFFFFFF);
  } else {
    // Support hex (#ff0000) and named colors (e.g. 'red') – Discord.js can handle named colors via parseInt? 
    // We'll try to parse hex, otherwise fallback to default.
    let hexMatch = colorRaw.match(/^#?([a-fA-F0-9]{6})$/);
    if (hexMatch) {
      colorInt = parseInt(hexMatch[1], 16);
    } else {
      // Named colors: map common ones
      const namedColors = {
        red: 0xff0000,
        green: 0x00ff00,
        blue: 0x0000ff,
        yellow: 0xffff00,
        orange: 0xffa500,
        purple: 0x800080,
        pink: 0xffc0cb,
        white: 0xffffff,
        black: 0x000000,
        blurple: 0x5865F2,
        grey: 0x808080,
      };
      const lower = colorRaw.toLowerCase();
      colorInt = namedColors[lower] || 0x5865F2;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(colorInt);

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer, iconURL: footerIcon || undefined });
  if (author) embed.setAuthor({ name: author, iconURL: authorIcon || undefined, url: authorUrl || undefined });
  if (timestamp) embed.setTimestamp();

  try {
    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send embed:', err);
    await interaction.reply({ content: '❌ Something went wrong while creating the embed. Check your URLs and try again.', ephemeral: true });
  }
});

// ─── Login ─────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
