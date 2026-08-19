const { Telegraf, Markup } = require('telegraf');
const aiService = require('../services/ai');
const calendarService = require('../services/calendar');
const fs = require('fs').promises;
const path = require('path');

class DentistBot {
  constructor() {
    this.bot = null;
    this.userStates = new Map();
    this.initialized = false;
  }

  async initialize() {
    try {
      if (!process.env.BOT_TOKEN) {
        throw new Error('BOT_TOKEN не указан в .env');
      }

      this.bot = new Telegraf(process.env.BOT_TOKEN);

      this.setupErrorHandling();
      this.setupMiddleware();
      this.setupCommands();
      this.setupBookingFlow();
      this.setupAIHandling();
      this.setupAdminCommands();

      console.log('✅ Telegram подключен');
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Telegram:', error.message);
      throw new Error(`Telegram: ${error.message}. Проверьте BOT_TOKEN в .env`);
    }
  }

  setupErrorHandling() {
    process.on('unhandledRejection', (error) => {
      console.error('⚠️ Необработанное исключение:', error);
      if (process.env.ADMIN_CHAT_ID && this.bot) {
        try {
          this.bot.telegram.sendMessage(
            process.env.ADMIN_CHAT_ID,
            `⚠️ Необработанное исключение:\n${error.message}\n\n${error.stack?.substring(0, 1000)}`
          );
        } catch (adminError) {
          console.error('Не удалось уведомить админа:', adminError);
        }
      }
    });

    this.bot.catch((err, ctx) => {
      console.error(`❌ Ошибка для ${ctx.updateType}:`, err);
      try {
        ctx.reply('Произошла ошибка. Пожалуйста, попробуйте еще раз или свяжитесь с администратором.');
      } catch (e) {
        console.error('Не удалось отправить сообщение об ошибке:', e);
      }
    });
  }

  setupMiddleware() {
    this.bot.use(async (ctx, next) => {
      console.log(`📨 От ${ctx.from?.id || 'unknown'}: ${ctx.message?.text?.substring(0, 50) || ctx.updateType}`);
      try {
        await next();
      } catch (error) {
        console.error('Ошибка middleware:', error);
        throw error;
      }
    });
  }

  setupCommands() {
    this.bot.start(async (ctx) => {
      try {
        await ctx.reply(
          '👋 Добро пожаловать в стоматологическую клинику!\n\n' +
          'Я помогу вам:\n' +
          '• 📅 Записаться на процедуру\n' +
          '• 💬 Получить консультацию\n' +
          '• ℹ️ Узнать информацию о услугах\n\n' +
          'Выберите действие:',
          Markup.keyboard([
            ['📅 Записаться'],
            ['💬 Задать вопрос'],
            ['ℹ️ О клинике']
          ]).resize()
        );
      } catch (error) {
        console.error('Ошибка в команде /start:', error);
      }
    });

    this.bot.hears('ℹ️ О клинике', async (ctx) => {
      try {
        await ctx.reply(
          '🏥 Наша стоматологическая клиника\n\n' +
          '• Современное оборудование\n' +
          '• Опытные специалисты\n' +
          '• Безболезненное лечение\n' +
          '• Удобное расположение\n\n' +
          'Работаем с 09:00 до 20:00, кроме воскресенья.\n\n' +
          'Для записи нажмите "📅 Записаться".'
        );
      } catch (error) {
        console.error('Ошибка в информации о клинике:', error);
      }
    });

    this.bot.hears('💬 Задать вопрос', async (ctx) => {
      try {
        await ctx.reply(
          '💬 Задайте ваш вопрос о процедурах, ценах или записи.\n\n' +
          'Я постараюсь помочь или предложу записаться на консультацию.',
          Markup.removeKeyboard()
        );
        this.userStates.set(ctx.chat.id, { state: 'awaiting_question' });
      } catch (error) {
        console.error('Ошибка в команде задать вопрос:', error);
      }
    });
  }

  setupBookingFlow() {
    this.bot.hears('📅 Записаться', async (ctx) => {
      try {
        const procedures = aiService.getProcedures();
        
        if (!procedures || procedures.length === 0) {
          await ctx.reply('Ошибка загрузки процедур. Пожалуйста, попробуйте позже.');
          return;
        }
        
        const buttons = procedures.map(procedure => 
          [Markup.button.callback(
            `${procedure.название} — ${procedure.цена}`, 
            `procedure_${procedure.id}`
          )]
        );

        await ctx.reply(
          '📅 Выберите процедуру:',
          Markup.inlineKeyboard(buttons)
        );
      } catch (error) {
        console.error('Ошибка в начале записи:', error);
        await ctx.reply(
          'Произошла ошибка при загрузке процедур. Пожалуйста, попробуйте позже.'
        );
      }
    });

    this.bot.action(/procedure_(.+)/, async (ctx) => {
      try {
        const procedureId = ctx.match[1];
        const procedure = aiService.getProcedureById(procedureId);
        
        if (!procedure) {
          await ctx.answerCbQuery('Процедура не найдена');
          return;
        }

        this.userStates.set(ctx.chat.id, { 
          state: 'selecting_date', 
          procedure: procedureId,
          procedureData: procedure
        });

        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

        await ctx.editMessageText(
          `Вы выбрали: ${procedure.название}\nЦена: ${procedure.цена}\n\nВыберите дату:`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('Сегодня', `date_${today.toISOString().split('T')[0]}`),
              Markup.button.callback('Завтра', `date_${tomorrow.toISOString().split('T')[0]}`),
            ],
            [
              Markup.button.callback('Послезавтра', `date_${dayAfterTomorrow.toISOString().split('T')[0]}`),
              Markup.button.callback('Другой день', 'other_date'),
            ]
          ])
        );
      } catch (error) {
        console.error('Ошибка выбора процедуры:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/date_(.+)/, async (ctx) => {
      try {
        const dateStr = ctx.match[1];
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState || !userState.procedure) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const selectedDate = new Date(dateStr);
        
        await ctx.editMessageText(
          `🔍 Ищу свободные окна на ${selectedDate.toLocaleDateString('ru-RU')}...`
        );

        const freeSlots = await calendarService.getFreeSlots(selectedDate);
        
        if (freeSlots.slots.length === 0) {
          let message = `На ${selectedDate.toLocaleDateString('ru-RU')} нет свободных окон.`;
          
          if (freeSlots.nextAvailable) {
            const nextDate = new Date(freeSlots.nextAvailable.date);
            message += `\n\nБлижайший доступный день: ${nextDate.toLocaleDateString('ru-RU')}`;
            
            const buttons = freeSlots.nextAvailable.slots.map(slot => 
              [Markup.button.callback(
                `${slot.formatted}`, 
                `time_${nextDate.toISOString().split('T')[0]}_${slot.formatted}`
              )]
            );
            
            buttons.push([Markup.button.callback('Выбрать другую дату', 'choose_date')]);
            
            await ctx.editMessageText(
              message,
              Markup.inlineKeyboard(buttons)
            );
            
            this.userStates.set(ctx.chat.id, { 
              ...userState, 
              selectedDate: nextDate.toISOString().split('T')[0]
            });
          } else {
            await ctx.editMessageText(
              message + '\n\nПожалуйста, выберите другую дату.',
              Markup.inlineKeyboard([
                [Markup.button.callback('Выбрать другую дату', 'choose_date')]
              ])
            );
          }
          return;
        }

        const buttons = freeSlots.slots.map(slot => 
          [Markup.button.callback(
            `${slot.formatted}`, 
            `time_${dateStr}_${slot.formatted}`
          )]
        );

        buttons.push([Markup.button.callback('Выбрать другую дату', 'choose_date')]);

        await ctx.editMessageText(
          `Доступные окна на ${selectedDate.toLocaleDateString('ru-RU')}:\n\n` +
          `Процедура: ${userState.procedureData.название}\n` +
          `Длительность: ${userState.procedureData.длительность_минут} минут`,
          Markup.inlineKeyboard(buttons)
        );

        this.userStates.set(ctx.chat.id, { 
          ...userState, 
          selectedDate: dateStr
        });
      } catch (error) {
        console.error('Ошибка выбора даты:', error);
        await ctx.editMessageText(
          'Произошла ошибка при поиске свободных окон. 😔\n\n' +
          'Пожалуйста, попробуйте позже.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Попробовать снова', 'retry_booking')]
          ])
        );
      }
    });

    this.bot.action('choose_date', async (ctx) => {
      try {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

        await ctx.editMessageText(
          'Выберите дату:',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('Сегодня', `date_${today.toISOString().split('T')[0]}`),
              Markup.button.callback('Завтра', `date_${tomorrow.toISOString().split('T')[0]}`),
            ],
            [
              Markup.button.callback('Послезавтра', `date_${dayAfterTomorrow.toISOString().split('T')[0]}`),
            ]
          ])
        );
      } catch (error) {
        console.error('Ошибка выбора другой даты:', error);
      }
    });

    this.bot.action(/time_(.+)_(.+)/, async (ctx) => {
      try {
        const [_, dateStr, timeStr] = ctx.match;
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState || !userState.procedure) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, { 
          ...userState, 
          state: 'entering_name',
          selectedDate: dateStr,
          selectedTime: timeStr
        });

        await ctx.editMessageText(
          `📝 Отлично! Вы выбрали:\n` +
          `Дата: ${new Date(dateStr).toLocaleDateString('ru-RU')}\n` +
          `Время: ${timeStr}\n` +
          `Процедура: ${userState.procedureData.название}\n\n` +
          `Теперь введите ваше имя:`
        );
      } catch (error) {
        console.error('Ошибка выбора времени:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.on('text', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          return;
        }

        if (userState.state === 'entering_name') {
          this.userStates.set(ctx.chat.id, { 
            ...userState, 
            state: 'entering_phone',
            patientName: ctx.message.text
          });

          await ctx.reply(
            `Отлично, ${ctx.message.text}! Теперь введите ваш номер телефона:\n` +
            `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`
          );
        } else if (userState.state === 'entering_phone') {
          const phone = ctx.message.text.trim();
          const phoneRegex = /^(\+7|8)\d{10}$/;
          
          if (!phoneRegex.test(phone)) {
            await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
            return;
          }

          const formattedPhone = phone.startsWith('8') ? '+7' + phone.slice(1) : phone;
          
          this.userStates.set(ctx.chat.id, { 
            ...userState, 
            state: 'confirming_booking',
            patientPhone: formattedPhone
          });

          await ctx.reply(
            `📋 Проверьте данные записи:\n\n` +
            `👤 Имя: ${userState.patientName}\n` +
            `📞 Телефон: ${formattedPhone}\n` +
            `📅 Дата: ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')}\n` +
            `⏰ Время: ${userState.selectedTime}\n` +
            `🦷 Процедура: ${userState.procedureData.название}\n` +
            `💰 Цена: ${userState.procedureData.цена}\n\n` +
            `Всё верно?`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Да, записать', 'confirm_booking'),
                Markup.button.callback('❌ Нет, исправить', 'cancel_booking')
              ]
            ])
          );
        }
      } catch (error) {
        console.error('Ошибка обработки текста:', error);
      }
    });

    this.bot.action('confirm_booking', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        await ctx.editMessageText('📅 Создаю запись в календаре...');

        const bookingResult = await calendarService.createBooking(
          userState.selectedDate,
          userState.selectedTime,
          {
            name: userState.patientName,
            phone: userState.patientPhone
          },
          userState.procedure
        );

        if (bookingResult.success) {
          await this.notifyAdminBooking(userState);
          
          await ctx.editMessageText(
            `✅ Запись успешно создана!\n\n` +
            `Ваша запись подтверждена на:\n` +
            `📅 ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')} в ${userState.selectedTime}\n\n` +
            `Мы ждём вас в клинике!\n\n` +
            `Если у вас есть вопросы, нажмите "💬 Задать вопрос".`
          );

          this.userStates.delete(ctx.chat.id);
        } else {
          throw new Error('Не удалось создать запись');
        }
      } catch (error) {
        console.error('Ошибка подтверждения записи:', error);
        await ctx.editMessageText(
          '😔 Не удалось создать запись. Пожалуйста, попробуйте позже.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Попробовать снова', 'retry_booking')]
          ])
        );
      }
    });

    this.bot.action('cancel_booking', async (ctx) => {
      try {
        this.userStates.delete(ctx.chat.id);
        await ctx.editMessageText(
          'Запись отменена. Чтобы начать заново, нажмите "📅 Записаться".',
          Markup.keyboard([['📅 Записаться'], ['💬 Задать вопрос']]).resize()
        );
      } catch (error) {
        console.error('Ошибка отмены записи:', error);
      }
    });

    this.bot.action('retry_booking', async (ctx) => {
      try {
        await ctx.deleteMessage();
        this.userStates.delete(ctx.chat.id);
        await ctx.reply(
          'Давайте попробуем снова!',
          Markup.keyboard([['📅 Записаться'], ['💬 Задать вопрос']]).resize()
        );
      } catch (error) {
        console.error('Ошибка повторной попытки:', error);
      }
    });
  }

  setupAIHandling() {
    this.bot.on('text', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        
        if (userState && userState.state === 'awaiting_question') {
          await ctx.sendChatAction('typing');
          
          const response = await aiService.generateResponse(ctx.message.text);
          
          await ctx.reply(
            response,
            Markup.inlineKeyboard([
              [Markup.button.callback('📅 Да, записать', 'start_booking_after_ai')]
            ])
          );
          
          this.userStates.delete(ctx.chat.id);
        } else if (!userState || !['entering_name', 'entering_phone'].includes(userState.state)) {
          if (ctx.message.text !== '📅 Записаться' && 
              ctx.message.text !== '💬 Задать вопрос' && 
              ctx.message.text !== 'ℹ️ О клинике') {
            
            await ctx.sendChatAction('typing');
            
            const response = await aiService.generateResponse(ctx.message.text);
            
            await ctx.reply(
              response,
              Markup.inlineKeyboard([
                [Markup.button.callback('📅 Да, записать', 'start_booking_after_ai')]
              ])
            );
          }
        }
      } catch (error) {
        console.error('Ошибка AI обработки:', error);
        await ctx.reply(
          'Извините, произошла ошибка при обработке вашего вопроса. 😔\n\n' +
          'Хотите записаться на консультацию? Нажмите "📅 Записаться".'
        );
      }
    });

    this.bot.action('start_booking_after_ai', async (ctx) => {
      try {
        await ctx.deleteMessage();
        await ctx.reply(
          'Отлично! Давайте начнем запись.',
          Markup.keyboard([['📅 Записаться']]).resize()
        );
      } catch (error) {
        console.error('Ошибка старта записи после AI:', error);
      }
    });
  }

  setupAdminCommands() {
    this.bot.command('stats', async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== process.env.ADMIN_CHAT_ID) {
          await ctx.reply('Эта команда доступна только администратору.');
          return;
        }

        const todayBookings = await calendarService.getTodayBookings();
        const weekBookings = await calendarService.getWeekBookings();

        const todayCount = todayBookings.length;
        const weekCount = weekBookings.length;

        const revenue = weekBookings.reduce((sum, event) => {
          const match = event.summary?.match(/— (\d+)₽/);
          if (match) {
            return sum + parseInt(match[1]);
          }
          return sum;
        }, 0);

        await ctx.reply(
          `📊 Статистика записей:\n\n` +
          `Сегодня: ${todayCount} записей\n` +
          `За неделю: ${weekCount} записей\n` +
          `Оборот за неделю: ${revenue}₽\n\n` +
          `Подробности в Google Calendar.`
        );
      } catch (error) {
        console.error('Ошибка команды /stats:', error);
        await ctx.reply('Ошибка при получении статистики.');
      }
    });
  }

  async notifyAdminBooking(userState) {
    try {
      if (!process.env.ADMIN_CHAT_ID) return;

      const message = `🆕 Новая запись!\n\n` +
        `👤 Пациент: ${userState.patientName}\n` +
        `📞 Телефон: ${userState.patientPhone}\n` +
        `📅 Дата: ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')}\n` +
        `⏰ Время: ${userState.selectedTime}\n` +
        `🦷 Процедура: ${userState.procedureData.название}\n` +
        `💰 Цена: ${userState.procedureData.цена}\n` +
        `⏱️ Длительность: ${userState.procedureData.длительность_минут} мин`;

      await this.bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, message);
    } catch (error) {
      console.error('Ошибка уведомления админа:', error);
    }
  }

  async start() {
    if (!this.initialized) {
      throw new Error('Бот не инициализирован');
    }

    try {
      await this.bot.launch();
      console.log('🤖 Бот запущен');
      
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      console.error('Ошибка запуска бота:', error);
      throw error;
    }
  }

  stop() {
    if (this.bot) {
      this.bot.stop();
      console.log('🛑 Бот остановлен');
    }
  }
}

module.exports = new DentistBot();