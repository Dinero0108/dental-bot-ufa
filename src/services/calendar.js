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
      const slotDuration = schedule.длина_слота_минут * 60 * 1000;

      const dayOfWeek = date.toLocaleDateString('ru-RU', { weekday: 'long' }).toLowerCase();
      if (schedule.выходные.includes(dayOfWeek)) {
        return { date: date.toISOString().split('T')[0], slots: [], nextAvailable: null };
      }

      const startTime = new Date(date);
      const [startHour, startMinute] = schedule.рабочие_часы.начало.split(':').map(Number);
      startTime.setHours(startHour, startMinute, 0, 0);

      const endTime = new Date(date);
      const [endHour, endMinute] = schedule.рабочие_часы.конец.split(':').map(Number);
      endTime.setHours(endHour, endMinute, 0, 0);

      const lunchStart = new Date(date);
      const [lunchStartHour, lunchStartMinute] = schedule.обеденный_перерыв.начало.split(':').map(Number);
      lunchStart.setHours(lunchStartHour, lunchStartMinute, 0, 0);

      const lunchEnd = new Date(date);
      const [lunchEndHour, lunchEndMinute] = schedule.обеденный_перерыв.конец.split(':').map(Number);
      lunchEnd.setHours(lunchEndHour, lunchEndMinute, 0, 0);

      const requestBody = {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        timeZone: 'Europe/Moscow',
        items: [{ id: this.calendarId }],
      };

      const response = await this.calendar.freebusy.query({
        requestBody,
      });

      const busySlots = response.data.calendars[this.calendarId]?.busy || [];

      const allSlots = [];
      let currentTime = new Date(startTime);

      while (currentTime < endTime) {
        const slotEnd = new Date(currentTime.getTime() + slotDuration);

        if (slotEnd <= lunchStart || currentTime >= lunchEnd) {
          const isBusy = busySlots.some(busy => {
            const busyStart = new Date(busy.start);
            const busyEnd = new Date(busy.end);
            return (currentTime >= busyStart && currentTime < busyEnd) ||
                   (slotEnd > busyStart && slotEnd <= busyEnd) ||
                   (currentTime <= busyStart && slotEnd >= busyEnd);
          });

          if (!isBusy) {
            allSlots.push({
              start: new Date(currentTime),
              end: new Date(slotEnd),
              formatted: currentTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            });
          }
        }

        currentTime = new Date(currentTime.getTime() + slotDuration);
      }

      const availableSlots = allSlots.slice(0, 5);

      let nextAvailableDate = null;
      if (availableSlots.length === 0) {
        nextAvailableDate = await this.findNextAvailableDate(date);
      }

      return {
        date: date.toISOString().split('T')[0],
        slots: availableSlots,
        nextAvailable: nextAvailableDate
      };
    } catch (error) {
      console.error('Ошибка при получении свободных слотов:', error);
      throw error;
    }
  }

  async findNextAvailableDate(startDate) {
    if (!this.initialized) return null;

    const schedule = require('../../config/schedule.json');
    let currentDate = new Date(startDate);
    
    for (let i = 0; i < 14; i++) {
      currentDate.setDate(currentDate.getDate() + 1);
      const dayOfWeek = currentDate.toLocaleDateString('ru-RU', { weekday: 'long' }).toLowerCase();
      
      if (!schedule.выходные.includes(dayOfWeek)) {
        try {
          const slots = await this.getFreeSlots(currentDate);
          if (slots.slots.length > 0) {
            return {
              date: currentDate.toISOString().split('T')[0],
              slots: slots.slots
            };
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    return null;
  }

  async createBooking(date, time, patient, procedure) {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const startDateTime = new Date(date);
      const [hours, minutes] = time.split(':').map(Number);
      startDateTime.setHours(hours, minutes, 0, 0);

      const schedule = require('../../config/schedule.json');
      const procedures = require('../../config/procedures.json');
      const procedureData = procedures.процедуры.find(p => p.id === procedure);
      const durationMinutes = procedureData ? procedureData.длительность_минут : 30;

      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

      const event = {
        summary: `${procedureData?.название || 'Процедура'} — ${patient.name}, ${patient.phone}`,
        description: `Пациент: ${patient.name}\nТелефон: ${patient.phone}\nПроцедура: ${procedureData?.название || 'Не указана'}\nЦена: ${procedureData?.цена || 'Не указана'}\nСоздано через Telegram-бота`,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'Europe/Moscow',
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'Europe/Moscow',
        },
        attendees: [{ email: patient.email }],
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