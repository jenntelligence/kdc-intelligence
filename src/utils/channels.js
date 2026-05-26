import { CHANNEL_BRAND_COLORS, CHANNEL_GROUP_COLORS } from '../constants/channels.js';

export const getChannelGroup = (ch) => {
  if (ch.startsWith('CS')) return 'CS';
  if (ch.startsWith('BS')) return 'BS';
  if (ch.startsWith('ECOM')) return 'ECOM';
  return ch;
};

export const getChannelColor = (ch) => {
  if (ch && CHANNEL_BRAND_COLORS[ch]) return CHANNEL_BRAND_COLORS[ch];
  return CHANNEL_GROUP_COLORS[getChannelGroup(ch || '')] || '#8a95a3';
};
