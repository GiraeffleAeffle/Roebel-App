import React, { useMemo } from 'react';
import { useWindowDimensions, StyleSheet } from 'react-native';
import RenderHTML from 'react-native-render-html';
import { useTheme } from '@/context/ThemeContext';
import type { ColorTokens } from '@/constants/theme';

type Props = {
  content: string;
};

// Static — react-native-render-html re-parses content whenever systemFonts
// or tagsStyles change identity, so these must not be recreated per render.
// Module scope for the static array; tagsStyles is memoized below since it
// closes over theme colors.
const systemFonts = [
  'Inter',
  'Inter-Bold',
  'Inter-Medium',
  'Inter-Medium',
  'Inter-Regular',
  'Inter-Medium',
  'Inter-Medium',
];

const classesStyles = {
  'code-block': {
    backgroundColor: '#1f2937',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
};

function createTagsStyles(colors: ColorTokens) {
  return {
    body: {
      fontSize: 16,
      lineHeight: 24,
      color: colors.textPrimary,
      fontFamily: 'Inter',
    },
    p: {
      fontSize: 16,
      lineHeight: 24,
      color: colors.textPrimary,
      fontFamily: 'Inter',
      marginTop: 0,
      marginBottom: 16,
    },
    h1: {
      fontSize: 28,
      lineHeight: 36,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginBottom: 16,
      marginTop: 0,
    },
    h2: {
      fontSize: 24,
      lineHeight: 32,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginBottom: 14,
      marginTop: 0,
    },
    h3: {
      fontSize: 20,
      lineHeight: 28,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginBottom: 12,
      marginTop: 0,
    },
    h4: {
      fontSize: 18,
      lineHeight: 24,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginBottom: 10,
      marginTop: 0,
    },
    ul: {
      marginBottom: 16,
      paddingLeft: 20,
    },
    ol: {
      marginBottom: 16,
      paddingLeft: 20,
    },
    li: {
      fontSize: 16,
      lineHeight: 24,
      color: colors.textPrimary,
      fontFamily: 'Inter',
      marginBottom: 8,
    },
    blockquote: {
      backgroundColor: colors.surfaceSecondary,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
      paddingLeft: 16,
      paddingVertical: 12,
      marginBottom: 16,
      fontFamily: 'Inter',
      fontStyle: 'italic' as const,
    },
    code: {
      backgroundColor: colors.surfaceSecondary,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: 'monospace',
      fontSize: 14,
    },
    pre: {
      backgroundColor: '#1f2937',
      padding: 16,
      borderRadius: 8,
      marginBottom: 16,
      overflow: 'scroll',
    },
    a: {
      color: colors.primary,
      textDecorationLine: 'underline',
    },
    strong: {
      fontFamily: 'Inter-Medium',
    },
    em: {
      fontFamily: 'Inter',
      fontStyle: 'italic' as const,
    },
    img: {
      marginVertical: 16,
    },
  };
}

export default function RichTextRenderer({ content }: Props) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();

  const tagsStyles = useMemo(() => createTagsStyles(colors), [colors]);

  return (
    <RenderHTML
      contentWidth={width - 32} // Account for padding
      source={{ html: content }}
      tagsStyles={tagsStyles}
      classesStyles={classesStyles}
      systemFonts={systemFonts}
      defaultTextProps={{
        selectable: true,
      }}
      enableExperimentalMarginCollapsing={true}
    />
  );
}
