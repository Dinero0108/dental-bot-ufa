const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

class CalendarService {
  constructor() {
    this.calendar = null;
    this.calendarId = process.env.GOOGLE_CALENDAR_ID;
    this.initialized = false;
    this.serviceAccountJson = null;
  }

  clinicMoment(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh - 5, mm));
  }

  clinicTime(dateObj) {
    let h = dateObj.getUTCHours() + 5;
    if (h >= 24) h -= 24;
    return String(h).padStart(2, '0') + ':' + 
           String(dateObj.getUTCMinutes()).padStart(2, '0');
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

  async getFreeSlots(date, doctorId = 'any') {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const schedule = require('../../config/schedule.json');
      const doctors = require('../../config/doctors.json');
      
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      if (schedule.daysOff.includes(dayOfWeek)) {
        console.log(`📅 [${dateStr}] Выходной день (${dayOfWeek})`);
        return { date: dateStr, slots: [], freeDoctorsBySlot: {} };
      }

      const startOfDay = this.clinicMoment(dateStr, '00:00');
      const endOfDay = this.clinicMoment(dateStr, '23:59');

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const doctorBusyIntervals = {};
      const allDoctorsBusyIntervals = [];

      doctors.doctors.forEach(doctor => {
        doctorBusyIntervals[doctor.id] = [];
      });

      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      response.data.items.forEach(event => {
        const start = event.start.dateTime ? new Date(event.start.dateTime) : null;
        const end = event.end.dateTime ? new Date(event.end.dateTime) : null;
        
        if (start && end && start < endOfDay && end > startOfDay) {
          const eventDescription = event.description || '';
          const doctorIdMatch = eventDescription.match(/doctor_id:\s*(\w+)/);
          
          if (doctorIdMatch) {
            const eventDoctorId = doctorIdMatch[1];
            if (doctorBusyIntervals[eventDoctorId]) {
              doctorBusyIntervals[eventDoctorId].push({ start, end });
            }
          } else {
            allDoctorsBusyIntervals.push({ start, end });
          }
        }
      });

      const allSlots = [];
      const slotDuration = schedule.slotMinutes * 60 * 1000;

      const startTimeStr = schedule.workStart;
      const endTimeStr = schedule.workEnd;
      
      const workStart = this.clinicMoment(dateStr, startTimeStr);
      const workEnd = this.clinicMoment(dateStr, endTimeStr);
      
      const lunchStart = this.clinicMoment(dateStr, schedule.lunchBreak.start);
      const lunchEnd = this.clinicMoment(dateStr, schedule.lunchBreak.end);

      let currentTime = new Date(workStart);

      while (currentTime < workEnd) {
        const slotEndTime = new Date(currentTime.getTime() + slotDuration);
        
        if (slotEndTime > workEnd) {
          break;
        }

        if (currentTime >= lunchStart && currentTime < lunchEnd) {
          currentTime = new Date(lunchEnd);
          continue;
        }

        const isPastSlot = isToday && currentTime < now;

        if (!isPastSlot) {
          const freeDoctors = [];
          const slotStartTime = new Date(currentTime);
          const slotEndTime = new Date(slotStartTime.getTime() + 30 * 60000);

          doctors.doctors.forEach(doctor => {
            const isBusy = doctorBusyIntervals[doctor.id].some(busy => {
              return slotStartTime < busy.end && slotEndTime > busy.start;
            });

            const isBlockedForAll = allDoctorsBusyIntervals.some(busy => {
              return slotStartTime < busy.end && slotEndTime > busy.start;
            });

            if (!isBusy && !isBlockedForAll) {
              freeDoctors.push(doctor.id);
            }
          });

          if (doctorId === 'any') {
            if (freeDoctors.length > 0) {
              allSlots.push({
                start: new Date(slotStartTime),
                end: new Date(slotEndTime),
                formatted: this.clinicTime(slotStartTime),
                freeDoctors: freeDoctors
              });
            }
          } else {
            const isBusy = doctorBusyIntervals[doctorId].some(busy => {
              return slotStartTime < busy.end && slotEndTime > busy.start;
            });

            const isBlockedForAll = allDoctorsBusyIntervals.some(busy => {
              return slotStartTime < busy.end && slotEndTime > busy.start;
            });

            if (!isBusy && !isBlockedForAll) {
              allSlots.push({
                start: new Date(slotStartTime),
                end: new Date(slotEndTime),
                formatted: this.clinicTime(slotStartTime),
                freeDoctors: [doctorId]
              });
            }
          }
        }

        currentTime = new Date(currentTime.getTime() + slotDuration);
      }

      const freeSlots = allSlots.slice(0, 20);
      const freeDoctorsBySlot = {};

      freeSlots.forEach(slot => {
        freeDoctorsBySlot[slot.formatted] = slot.freeDoctors;
      });

      const busyCount = doctorId === 'any' 
        ? allDoctorsBusyIntervals.length 
        : (doctorBusyIntervals[doctorId]?.length || 0) + allDoctorsBusyIntervals.length;

      console.log(`📅 [${dateStr}] Врач ${doctorId}: занято ${busyCount}, свободно ${freeSlots.length}`);

      return {
        date: dateStr,
        slots: freeSlots,
        freeDoctorsBySlot: freeDoctorsBySlot
      };
    } catch (error) {
      console.error('Ошибка при получении свободных слотов:', error);
      throw error;
    }
  }

  async findNextAvailableSlots(startDate, doctorId = 'any') {
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
            const slots = await this.getFreeSlots(currentDate, doctorId);
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

  async checkSlotAvailability(date, time, doctorId, durationMinutes) {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const doctors = require('../../config/doctors.json');
      const startDateTime = this.clinicMoment(date, time);
      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

      const startOfDay = this.clinicMoment(date, '00:00');
      const endOfDay = this.clinicMoment(date, '23:59');

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const doctorBusyIntervals = [];
      const allDoctorsBusyIntervals = [];

      response.data.items.forEach(event => {
        const start = event.start.dateTime ? new Date(event.start.dateTime) : null;
        const end = event.end.dateTime ? new Date(event.end.dateTime) : null;
        
        if (start && end) {
          const eventDescription = event.description || '';
          const doctorIdMatch = eventDescription.match(/doctor_id:\s*(\w+)/);
          
          if (doctorIdMatch) {
            const eventDoctorId = doctorIdMatch[1];
            if (eventDoctorId === doctorId) {
              doctorBusyIntervals.push({ start, end });
            }
          } else {
            allDoctorsBusyIntervals.push({ start, end });
          }
        }
      });

      const isBusy = doctorBusyIntervals.some(busy => {
        return startDateTime < busy.end && endDateTime > busy.start;
      });

      const isBlockedForAll = allDoctorsBusyIntervals.some(busy => {
        return startDateTime < busy.end && endDateTime > busy.start;
      });

      return !isBusy && !isBlockedForAll;
    } catch (error) {
      console.error('Ошибка проверки доступности слота:', error);
      throw error;
    }
  }

  async createBooking(date, time, patient, procedure, doctorId) {
    if (!this.initialized || !this.calendar) {
      throw new Error('Google Calendar не инициализирован');
    }

    try {
      const doctors = require('../../config/doctors.json');
      const procedures = require('../../config/procedures.json');
      const procedureData = procedures.процедуры.find(p => p.id === procedure);
      const durationMinutes = procedureData ? procedureData.длительность_минут : 30;

      const doctor = doctors.doctors.find(d => d.id === doctorId);
      if (!doctor && doctorId !== 'any') {
        throw new Error(`Врач с ID "${doctorId}" не найден`);
      }

      if (doctorId !== 'any') {
        const isAvailable = await this.checkSlotAvailability(date, time, doctorId, durationMinutes);
        
        if (!isAvailable) {
          return {
            success: false,
            error: 'slot_busy',
            message: 'Время уже занято'
          };
        }
      } else {
        const slots = await this.getFreeSlots(date, 'any');
        const slot = slots.slots.find(s => s.formatted === time);
        
        if (!slot || slot.freeDoctors.length === 0) {
          return {
            success: false,
            error: 'slot_busy',
            message: 'Время уже занято'
          };
        }
      }

      const actualDoctorId = doctorId === 'any' ? null : doctorId;
      const startDateTime = this.clinicMoment(date, time);
      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

      const procName = (p) => {
        if (!p) return 'Процедура';
        if (typeof p === 'string') {
          const found = procedures.процедуры.find(x => x.id === p);
          return found ? found.название : p;
        }
        return p.name || p.title || p.id || 'Процедура';
      };

      let summary = '';
      if (patient.priority === 'urgent') {
        summary = `🚨 СРОЧНО — ${patient.name}, ${patient.phone}`;
      } else if (patient.isReturningPatient) {
        summary = `${procName(procedure)} — ${patient.name} (постоянный пациент)`;
      } else {
        summary = `${procName(procedure)} — ${patient.name}, ${patient.phone}`;
      }

      if (actualDoctorId && doctor) {
        summary += ` (${doctor.name})`;
      }

      let description = `Пациент: ${patient.name}\nТелефон: ${patient.phone}\nПроцедура: ${procName(procedure)}`;
      
      if (actualDoctorId) {
        description += `\ndoctor_id: ${actualDoctorId}`;
      }
      
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
          timeZone: 'Asia/Yekaterinburg',
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'Asia/Yekaterinburg',
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
        end: response.data.end.dateTime,
        doctorId: actualDoctorId
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