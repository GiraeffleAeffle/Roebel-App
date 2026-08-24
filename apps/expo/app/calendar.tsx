import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import EventCard from '@/components/EventCard';
import BottomNavigation from '@/components/BottomNavigation';
import { supabase } from '@/lib/supabase';
import { EventRecord } from '@/lib/types';
import { useTheme } from '@/context/ThemeContext';

export default function CalendarScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'map' | 'profile'>('home');
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  // Integer cell size so 7 columns never overflow and wrap (percentage widths
  // round to > 100% on some devices, pushing the Sunday column to the next row)
  const [gridAreaWidth, setGridAreaWidth] = useState(windowWidth - 32);
  const daySize = Math.floor(gridAreaWidth / 7);
  const gridWidth = daySize * 7;

  // Fetch events on component mount
  useEffect(() => {
    async function fetchEvents() {
      setLoading(true);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'approved')
        .order('date', { ascending: true })
        .order('time', { ascending: true, nullsFirst: true });

      if (error) {
        console.error('Calendar events error:', error);
        setEvents([]);
      } else {
        setEvents(data as EventRecord[]);
      }
      setLoading(false);
    }

    fetchEvents();
  }, []);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Add padding days so the 1st lands under its real weekday (Monday-first grid)
  const startDayOfWeek = monthStart.getDay();
  const paddingDays = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
  const paddingDaysArray = Array.from({ length: paddingDays }, (_, i) => {
    const date = new Date(monthStart);
    date.setDate(date.getDate() - (paddingDays - i));
    return date;
  });
  const allDays = [...paddingDaysArray, ...calendarDays];

  // Group events by date
  const eventsByDate = useMemo(() => {
    const grouped: { [key: string]: EventRecord[] } = {};
    events.forEach(event => {
      const dateKey = event.date;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    return grouped;
  }, [events]);

  // Get events for selected date
  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) return [];
    const dateKey = format(selectedDate, 'yyyy-MM-dd');
    return eventsByDate[dateKey] || [];
  }, [selectedDate, eventsByDate]);

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1));
    setCurrentDate(newDate);
    setSelectedDate(null);
  };

  const handleDatePress = (date: Date) => {
    if (!isSameMonth(date, currentDate)) return; // Ignore padding days from adjacent months
    setSelectedDate(isSameDay(date, selectedDate || new Date('1900-01-01')) ? null : date);
  };

  const handleTabPress = (tab: 'home' | 'explore' | 'map' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'explore') {
      router.replace('/explore');
    } else if (tab === 'map') {
      router.push('/location');
    } else if (tab === 'profile') {
      router.replace('/profile');
    } else if (tab === 'home') {
      router.replace('/');
    }
  };

  const renderDay = (date: Date, index: number) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const hasEvents = eventsByDate[dateKey] && eventsByDate[dateKey].length > 0;
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const isCurrentMonth = isSameMonth(date, currentDate);
    const isTodayDate = isToday(date);

    return (
      <Pressable
        key={index}
        style={[
          styles.dayContainer,
          { width: daySize, height: daySize },
          !isCurrentMonth && styles.dayOutsideMonth,
        ]}
        onPress={() => handleDatePress(date)}
      >
        <View style={[
          styles.dayContent,
          (isTodayDate || isSelected) && { backgroundColor: colors.surfaceSecondary },
        ]}>
          <Text style={[
            styles.dayText,
            { color: colors.textPrimary },
            !isCurrentMonth && { color: colors.disabled },
            (isTodayDate || isSelected) && { color: colors.textPrimary, fontFamily: 'Inter-Medium' },
          ]}>
            {format(date, 'd')}
          </Text>
          {hasEvents && (
            <View style={[styles.eventIndicator, { backgroundColor: colors.primary }]} />
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Kalender schließen"
            hitSlop={8}
          >
            <Text style={[styles.closeIcon, { color: colors.textPrimary }]}>✕</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Kalender</Text>
          <View style={styles.closeButton} />
        </View>

        {/* Calendar */}
        <View
          style={[styles.calendarContainer, { backgroundColor: colors.background }]}
          onLayout={(e) => setGridAreaWidth(e.nativeEvent.layout.width - 32)}
        >
          {/* Month navigation */}
          <View style={styles.monthHeader}>
            <Pressable onPress={() => navigateMonth('prev')} style={[styles.navButton, { backgroundColor: colors.surfaceSecondary }]}>
              <ChevronLeft size={20} color={colors.tabIconActive} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>
              {format(currentDate, 'MMMM yyyy', { locale: de })}
            </Text>
            <Pressable onPress={() => navigateMonth('next')} style={[styles.navButton, { backgroundColor: colors.surfaceSecondary }]}>
              <ChevronRight size={20} color={colors.tabIconActive} />
            </Pressable>
          </View>

          {/* Weekday headers */}
          <View style={[styles.weekHeader, { width: gridWidth }]}>
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day) => (
              <View key={day} style={[styles.weekDayContainer, { width: daySize }]}>
                <Text style={[styles.weekDayText, { color: colors.textTertiary }]}>{day}</Text>
              </View>
            ))}
          </View>

          {/* Calendar grid */}
          <View style={[styles.calendarGrid, { width: gridWidth }]}>
            {allDays.map((date, index) => renderDay(date, index))}
          </View>
        </View>

        {/* Selected date events */}
        {selectedDate && (
          <View style={styles.eventsSection}>
            <Text style={[styles.eventsTitle, { color: colors.textPrimary }]}>
              {format(selectedDate, 'EEEE, d. MMMM yyyy', { locale: de })}
            </Text>
            {loading ? (
              <Text style={[styles.loadingText, { color: colors.textTertiary }]}>Lade Veranstaltungen...</Text>
            ) : selectedDateEvents.length === 0 ? (
              <Text style={[styles.noEventsText, { color: colors.textTertiary }]}>
                Keine Veranstaltungen an diesem Tag
              </Text>
            ) : (
              selectedDateEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))
            )}
          </View>
        )}
      </ScrollView>

      <BottomNavigation
        activeTab={activeTab}
        onTabPress={handleTabPress}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 16,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    fontSize: 20,
    fontFamily: 'Inter-Regular',
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter-Medium',
    textAlign: 'center',
  },
  calendarContainer: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 16,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  monthTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Medium',
    textTransform: 'capitalize',
  },
  navButton: {
    padding: 8,
    borderRadius: 8,
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: 8,
    alignSelf: 'center',
  },
  weekDayContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  weekDayText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'center',
  },
  dayContainer: {
    padding: 2,
  },
  dayContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    position: 'relative',
  },
  dayText: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
  },
  dayOutsideMonth: {
    opacity: 0.5,
  },
  eventIndicator: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  eventsSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  eventsTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Medium',
    marginBottom: 16,
    textTransform: 'capitalize',
  },
  loadingText: {
    textAlign: 'center',
    fontFamily: 'Inter',
    marginTop: 20,
  },
  noEventsText: {
    textAlign: 'center',
    fontFamily: 'Inter',
    marginTop: 20,
  },
});
