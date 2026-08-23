import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '@/context/ThemeContext';
import type { ColorTokens } from '@/constants/theme';

interface MarkdownRendererProps {
  content: string;
}

// Hoisted out of the component so the ~150-key style object isn't rebuilt on
// every render (this renderer runs per chat bubble, per streamed token).
function createMarkdownStyles(colors: ColorTokens) {
  return StyleSheet.create({
    // Body
    body: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
    },

    // Headings
    heading1: {
      fontSize: 28,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginTop: 24,
      marginBottom: 16,
      lineHeight: 34,
    },
    heading2: {
      fontSize: 24,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginTop: 20,
      marginBottom: 12,
      lineHeight: 30,
    },
    heading3: {
      fontSize: 20,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginTop: 16,
      marginBottom: 8,
      lineHeight: 26,
    },
    heading4: {
      fontSize: 18,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginTop: 12,
      marginBottom: 6,
      lineHeight: 24,
    },
    heading5: {
      fontSize: 16,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      marginTop: 10,
      marginBottom: 6,
      lineHeight: 22,
    },
    heading6: {
      fontSize: 14,
      fontFamily: 'Inter-Medium',
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 4,
      lineHeight: 20,
    },

    // Horizontal rule
    hr: {
      backgroundColor: colors.borderSecondary,
      height: 1,
      marginVertical: 20,
    },

    // Emphasis
    strong: {
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
    },
    em: {
      fontStyle: 'italic',
      color: colors.textPrimary,
    },
    s: {
      textDecorationLine: 'line-through',
      color: colors.textTertiary,
    },

    // Blockquotes
    blockquote: {
      backgroundColor: colors.surfaceSecondary,
      borderLeftWidth: 4,
      borderLeftColor: '#3b82f6',
      paddingVertical: 8,
      paddingHorizontal: 16,
      marginVertical: 12,
    },

    // Lists
    bullet_list: {
      marginVertical: 8,
    },
    ordered_list: {
      marginVertical: 8,
    },
    list_item: {
      marginVertical: 4,
      flexDirection: 'row',
    },
    bullet_list_icon: {
      marginLeft: 8,
      marginRight: 8,
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 24,
    },
    bullet_list_content: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
    },
    ordered_list_icon: {
      marginLeft: 8,
      marginRight: 8,
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 24,
    },
    ordered_list_content: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
    },

    // Code
    code_inline: {
      backgroundColor: colors.surfaceSecondary,
      color: '#ec4899',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: 'Courier',
      fontSize: 14,
    },
    code_block: {
      backgroundColor: '#1f2937',
      color: '#e5e7eb',
      padding: 16,
      borderRadius: 8,
      marginVertical: 12,
      fontFamily: 'Courier',
      fontSize: 14,
      lineHeight: 20,
    },
    fence: {
      backgroundColor: '#1f2937',
      color: '#e5e7eb',
      padding: 16,
      borderRadius: 8,
      marginVertical: 12,
      fontFamily: 'Courier',
      fontSize: 14,
      lineHeight: 20,
    },

    // Links
    link: {
      color: '#3b82f6',
      textDecorationLine: 'underline',
    },

    // Images
    image: {
      marginVertical: 12,
      borderRadius: 8,
    },

    // Paragraphs
    paragraph: {
      marginVertical: 8,
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
    },

    // Tables
    table: {
      marginVertical: 12,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: 8,
    },
    thead: {
      backgroundColor: colors.surfaceSecondary,
    },
    tbody: {},
    th: {
      padding: 12,
      fontFamily: 'Inter-Medium',
      color: colors.textPrimary,
      fontSize: 14,
      borderRightWidth: 1,
      borderRightColor: colors.borderSecondary,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSecondary,
    },
    tr: {
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSecondary,
      flexDirection: 'row',
    },
    td: {
      padding: 12,
      fontSize: 14,
      color: colors.textPrimary,
      borderRightWidth: 1,
      borderRightColor: colors.borderSecondary,
      flex: 1,
    },
  });
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const { colors } = useTheme();
  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);

  return (
    <Markdown style={markdownStyles}>
      {content}
    </Markdown>
  );
}
