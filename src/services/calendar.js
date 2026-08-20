const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

class CalendarService {
  constructor() {
    this.calendar = null;
    this.calendarId = process.env.GOOGLE_CALENDAR_ID;
    this.serviceAccountJson = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON не указан в .env');
      }

      if (!this.calendarId) {
        throw new Error('GOOGLE_CALENDAR_ID не указан в .env');
      }

      const jsonString = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
      this.serviceAccountJson = JSON.parse(jsonString);

      const auth = new google.auth.GoogleAuth({
        credentials: this.serviceAccountJson,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      this.calendar = google.calendar({ version: 'v3', auth });
      
      await this.calendar.calendarList.list();
      console.log('✅ Google Calendar подключен');
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Google Calendar:', error.message);
      throw new Error(`Google Calendar: ${error.message}. Проверьте GOOGLE_SERVICE_ACCOUNT_JSON и GOOGLE_CALENDAR_ID в .env`);
    }
  }

  async getFreeSlots(date) {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const schedule = require('../../config/schedule.json');
      
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      if (schedule.daysOff.includes(dayOfWeek)) {
        console.log(`📅 [${date.toISOString().split('T')[0]}] Выходной день (${dayOfWeek})`);
        return { date: date.toISOString().split('T')[0], slots: [] };
      }

      const [workStartHour, workStartMinute] = schedule.workStart.split(':').map(Number);
      const [workEndHour, workEndMinute] = schedule.workEnd.split(':').map(Number);
      const slotDuration = schedule.slotMinutes * 60 * 1000;

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const busyIntervals = [];
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      response.data.items.forEach(event => {
        const start = event.start.dateTime ? new Date(event.start.dateTime) : null;
        const end = event.end.dateTime ? new Date(event.end.dateTime) : null;
        
        if (start && end && start < endOfDay && end > startOfDay) {
          busyIntervals.push({ start, end });
        }
      });

      const allSlots = [];
      const slotStart = new Date(date);
      slotStart.setHours(workStartHour, workStartMinute, 0, 0);

      const slotEnd = new Date(date);
      slotEnd.setHours(workEndHour, workEndMinute, 0, 0);

      let currentTime = new Date(slotStart);

      while (currentTime < slotEnd) {
        const slotEndTime = new Date(currentTime.getTime() + slotDuration);
        
        if (slotEndTime > slotEnd) {
          break;
        }

        const lunchStart = new Date(date);
        const [lunchStartHour, lunchStartMinute] = schedule.lunchBreak.start.split(':').map(Number);
        lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);

        const lunchEnd = new Date(date);
        const [lunchEndHour, lunchEndMinute] = schedule.lunchBreak.end.split(':').map(Number);
        lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);

        if (currentTime >= lunchStart && currentTime < lunchEnd) {
          currentTime = new Date(lunchEnd);
          continue;
        }

        const isSlotBusy = busyIntervals.some(busy => {
          return currentTime < busy.end && slotEndTime > busy.start;
        });

        const isPastSlot = isToday && currentTime < now;

        if (!isSlotBusy && !isPastSlot) {
          allSlots.push({
            start: new Date(currentTime),
            end: new Date(slotEndTime),
            formatted: currentTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          });
        }

        currentTime = new Date(currentTime.getTime() + slotDuration);
      }

      const freeSlots = allSlots.slice(0, 6);

      console.log(`📅 [${date.toISOString().split('T')[0]}] Занято слотов: ${busyIntervals.length}, Свободно: ${freeSlots.length}`);

      return {
        date: date.toISOString().split('T')[0],
        slots: freeSlots
      };
    } catch (error) {
      console.error('Ошибка при получении свободных слотов:', error);
      throw error;
    }
  }

  async findNextAvailableSlots(startDate) {
    if (!this.initialized) return [];

    try {
      const schedule = require('../../config/schedule.json');
      const results = [];
      let currentDate = new Date(startDate);
      
      for (let i = 0; i < schedule.bookingDaysAhead; i++) {
        currentDate.setDate(currentDate.getDate() + 1);
        const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        if (!schedule.daysOff.includes(dayOfWeek)) {
          try {
            const slots = await this.getFreeSlots(currentDate);
            if (slots.slots.length > 0) {
              results.push({
                date: currentDate.toISOString().split('T')[0],
                dateFormatted: currentDate.toLocaleDateString('ru-RU'),
                slots: slots.slots.slice(0, 3)
              });
              
              if (results.length >= 3) break;
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Ошибка поиска ближайших свободных дней:', error);
      return [];
    }
  }

  async checkSlotAvailability(date, time, durationMinutes) {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const [hours, minutes] = time.split(':').map(Number);
      const startDateTime = new Date(date);
      startDateTime.setHours(hours, minutes, 0, 0);

      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const busyIntervals = response.data.items
        .filter(event => event.start.dateTime && event.end.dateTime)
        .map(event => ({
          start: new Date(event.start.dateTime),
          end: new Date(event.end.dateTime)
        }));

      const isSlotBusy = busyIntervals.some(busy => {
        return startDateTime < busy.end && endDateTime > busy.start;
      });

      return !isSlotBusy;
    } catch (error) {
      console.error('Ошибка проверки доступности слота:', error);
      throw error;
    }
  }

  async createBooking(date, time, patient, procedure) {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const procedures = require('../../config/procedures.json');
      const procedureData = procedures.процедуры.find(p => p.id === procedure);
      const durationMinutes = procedureData ? procedureData.длительность_минут : 30;

      const isAvailable = await this.checkSlotAvailability(date, time, durationMinutes);
      
      if (!isAvailable) {
        return {
          success: false,
          error: 'slot_busy',
          message: 'Время уже занято'
        };
      }

      const startDateTime = new Date(date);
      const [hours, minutes] = time.split(':').map(Number);
      startDateTime.setHours(hours, minutes, 0, 0);

      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

      let summary = '';
      if (patient.priority === 'urgent') {
        summary = `🚨 СРОЧНО — ${patient.name}, ${patient.phone}`;
      } else if (patient.isReturningPatient) {
        summary = `${procedureData?.название || 'Процедура'} — ${patient.name} (постоянный пациент)`;
      } else {
        summary = `${procedureData?.название || 'Процедура'} — ${patient.name}, ${patient.phone}`;
      }

      let description = `Пациент: ${patient.name}\nТелефон: ${patient.phone}\nПроцедура: ${procedureData?.название || 'Не указана'}`;
      
      if (patient.priority === 'urgent') {
        description += `\nПроблема: ${patient.problemDescription || 'Не указана'}\nВНЕ ОЧЕРЕДИ`;
      } else if (patient.isReturningPatient && patient.problemDescription) {
        description += `\nПримечание: ${patient.problemDescription}\nПостоянный пациент`;
      } else if (patient.problemDescription) {
        description += `\nПримечание: ${patient.problemDescription}`;
      }
      
      description += `\nСоздано через Telegram-бота`;

      const event = {
        summary,
        description,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'Europe/Moscow',
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'Europe/Moscow',
        },
        reminders: {
          useDefault: true,
        },
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
      });

      return {
        success: true,
        eventId: response.data.id,
        htmlLink: response.data.htmlLink,
        start: response.data.start.dateTime,
        end: response.data.end.dateTime
      };
    } catch (error) {
      console.error('Ошибка при создании записи:', error);
      
      if (error.message.includes('slot_busy')) {
        return {
          success: false,
          error: 'slot_busy',
          message: 'Время уже занято'
        };
      }
      
      throw error;
    }
  }

  async getTodayBookings() {
    if (!this.initialized) return [];

    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Ошибка при получении записей за сегодня:', error);
      return [];
    }
  }

  async getWeekBookings() {
    if (!this.initialized) return [];

    try {
      const now = new Date();
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1);
      const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 8);

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfWeek.toISOString(),
        timeMax: endOfWeek.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Ошибка при получении записей за неделю:', error);
      return [];
    }
  }
}

module.exports = new CalendarService();