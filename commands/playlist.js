require('dotenv').config()
const { MessageEmbed } = require("discord.js");
const { play } = require("../include/play");
const { YOUTUBE_API_KEY, MAX_PLAYLIST_SIZE, SOUNDCLOUD_CLIENT_ID } = require("../config.json");
const YouTubeAPI = require("simple-youtube-api");
const youtube = new YouTubeAPI(process.env.YOUTUBE_API_KEY);
const scdl = require("soundcloud-downloader")
var SpotifyWebApi = require('spotify-web-api-node');
var spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: 'https://srtk.me'
});

spotifyApi.clientCredentialsGrant()
  .then(function (data) {
    spotifyApi.setAccessToken(data.body['access_token']);
  }, function (err) {
    console.log('Something went wrong when retrieving an access token', err.message);
  });

module.exports = {
  name: "playlist",
  cooldown: 3,
  aliases: ["pl"],
  description: "Play a playlist from youtube",
  async execute(message, args) {
    const { PRUNING } = require("../config.json");
    const { channel } = message.member.voice;

    const serverQueue = message.client.queue.get(message.guild.id);
    if (serverQueue && channel !== message.guild.me.voice.channel)
      return message.reply(`You must be in the same channel as ${message.client.user}`).catch(console.error);

    if (!args.length)
      return message
        .reply(`Usage: ${message.client.prefix}playlist <YouTube Playlist URL | Playlist Name>`)
        .catch(console.error);
    if (!channel) return message.reply("You need to join a voice channel first!").catch(console.error);

    const permissions = channel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT"))
      return message.reply("Cannot connect to voice channel, missing permissions");
    if (!permissions.has("SPEAK"))
      return message.reply("I cannot speak in this voice channel, make sure I have the proper permissions!");

    const search = args.join(" ");
    const pattern = /^.*(youtu.be\/|list=)([^#\&\?]*).*/gi;
    const url = args[0];
    const urlValid = pattern.test(args[0]);

    const queueConstruct = {
      textChannel: message.channel,
      channel,
      connection: null,
      songs: [],
      loop: false,
      volume: 100,
      playing: true
    };

    let song = null;
    let playlist = null;
    let videos = [];

    if (urlValid) {
      try {
        playlist = await youtube.getPlaylist(url, {
          part: "snippet"
        });
        videos = await playlist.getVideos(MAX_PLAYLIST_SIZE || 10, {
          part: "snippet"
        });
      } catch (error) {
        console.error(error);
        return message.reply("Playlist not found :(").catch(console.error);
      }
    } else if (scdl.isValidUrl(args[0])) {
      if (args[0].includes('/sets/')) {
        message.channel.send('⌛ fetching the playlist...')
        playlist = await scdl.getSetInfo(args[0], SOUNDCLOUD_CLIENT_ID)
        videos = playlist.tracks.map(track => ({
          title: track.title,
          url: track.permalink_url,
          duration: track.duration / 1000
        }))
      }
    } else if (url.includes("https://open.spotify.com/album") || url.includes("https://open.spotify.com/playlist")) {
      try {
        spotifyApi.clientCredentialsGrant()
          .then(function (data) {
            spotifyApi.setAccessToken(data.body['access_token']);
          }, function (err) {
            console.log('Something went wrong when retrieving an access token', err.message);
          });
        if (url.includes('/album/')) {
          message.channel.send('⌛ fetching the album...');
          let spotifyAlbumRegex = RegExp(/https:\/\/open.spotify.com\/album\/(.+)\?(.+)/gi);
          let spotifyAlbumId = spotifyAlbumRegex.exec(url)[1];
          playlist = await spotifyApi.getAlbumTracks(spotifyAlbumId);
          videos = playlist.body.items.map(track => ({
            title: track.name,
            url: track.preview_url,
            duration: track.duration_ms / 1000
          }));
        } else if (url.includes('/playlist/')) {
          message.channel.send('⌛ fetching the playlist...');
          let spotifyPlaylistRegex = RegExp(/https:\/\/open.spotify.com\/playlist\/(.+)\?(.+)/gi);
          let spotifyPlaylistId = spotifyPlaylistRegex.exec(url)[1];
          playlist = await spotifyApi.getPlaylistTracks(spotifyPlaylistId);
          console.log(playlist.body.items);
          playlist.body.items.forEach((track) => {
            console.log(track.name, track.preview_url, track.duration_ms);
          });
          videos = playlist.body.items.map(track => ({
            title: track.name,
            url: track.preview_url,
            duration: track.duration_ms / 1000
          }));
        }
      } catch (error) {
        console.error(error);
        return message.reply("I can't find a playlist or album with that link.").catch(console.error);
      }
    } else {
      try {
        const results = await youtube.searchPlaylists(search, 1, {
          part: "snippet"
        });
        playlist = results[0];
        videos = await playlist.getVideos(MAX_PLAYLIST_SIZE || 10, {
          part: "snippet"
        });
      } catch (error) {
        console.error(error);
        return message.reply("Playlist not found :(").catch(console.error);
      }
    }

    videos.forEach((video) => {
      song = {
        title: video.title,
        url: video.url,
        duration: video.durationSeconds
      };
      console.log(song);
      if (serverQueue) {
        serverQueue.songs.push(song);
        if (!PRUNING)
          message.channel
          .send(`✅ **${song.title}** has been added to the queue by ${message.author}`)
          .catch(console.error);
      } else {
        queueConstruct.songs.push(song);
      }
    });

    console.log(videos);
    console.log(playlist);

    let playlistEmbed = new MessageEmbed()
      .setTitle(`${playlist.title}`)
      .setURL(playlist.url)
      .setColor("#F8AA2A")
      .setTimestamp();

    if (!PRUNING) {
      playlistEmbed.setDescription(queueConstruct.songs.map((song, index) => `${index + 1}. ${song.title}`));
      if (playlistEmbed.description.length >= 2048)
        playlistEmbed.description =
        playlistEmbed.description.substr(0, 2007) + "\nPlaylist larger than character limit...";
    }

    message.channel.send(`${message.author} Started a playlist`, playlistEmbed);

    if (!serverQueue) message.client.queue.set(message.guild.id, queueConstruct);

    if (!serverQueue) {
      try {
        queueConstruct.connection = await channel.join();
        await queueConstruct.connection.voice.setSelfDeaf(true);
        play(queueConstruct.songs[0], message);
      } catch (error) {
        console.error(error);
        message.client.queue.delete(message.guild.id);
        await channel.leave();
        return message.channel.send(`Could not join the channel: ${error}`).catch(console.error);
      }
    }
  }
};