const { Telegraf, Markup } = require('telegraf');
const aiService = require('../services/ai');
const calendarService = require('../services/calendar');
const patientsService = require('../services/patients');

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
      this.setupProfileCommands();

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
          '• ℹ️ Узнать информацию о услугах\n' +
          '• 👤 Управление профилем\n\n' +
          'Выберите действие:',
          Markup.keyboard([
            ['📅 Записаться'],
            ['💬 Задать вопрос'],
            ['ℹ️ О клинике'],
            ['👤 Мой профиль']
          ]).resize()
        );
      } catch (error) {
        console.error('Ошибка в команде /start:', error);
      }
    });

    this.bot.hears('ℹ️ О клинике', async (ctx) => {
      try {
        const doctors = require('../../config/doctors.json');
        const doctorsList = doctors.doctors.map(d => `• ${d.name} — ${d.specialty}`).join('\n');

        await ctx.reply(
          '🏥 Наша стоматологическая клиника\n\n' +
          '• Современное оборудование\n' +
          '• Опытные специалисты\n' +
          '• Безболезненное лечение\n' +
          '• Удобное расположение\n\n' +
          `Наши врачи:\n${doctorsList}\n\n` +
          'Работаем с 09:00 до 20:00, кроме воскресенья.\n\n' +
          'Для записи нажмите "📅 Записаться".'
        );
      } catch (error) {
        console.error('Ошибка в информации о клинике:', error);
      }
    });

    this.bot.hears('👤 Мой профиль', async (ctx) => {
      try {
        await this.showProfile(ctx);
      } catch (error) {
        console.error('Ошибка в команде профиля:', error);
        await ctx.reply('Произошла ошибка при загрузке профиля.');
      }
    });

    this.bot.hears('💬 Задать вопрос', async (ctx) => {
      try {
        await ctx.reply(
          '💬 Задайте ваш вопрос о процедурах, ценах или записи.\n\n' +
          'Я постараюсь помочь или предложу записаться на консультацию.',
          undefined
        );
        this.userStates.set(ctx.chat.id, { state: 'awaiting_question' });
      } catch (error) {
        console.error('Ошибка в команде задать вопрос:', error);
      }
    });
  }

  setupProfileCommands() {
    this.bot.command('myprofile', async (ctx) => {
      try {
        await this.showProfile(ctx);
      } catch (error) {
        console.error('Ошибка команды /myprofile:', error);
        await ctx.reply('Произошла ошибка при загрузке профиля.');
      }
    });

    this.bot.command('addfamily', async (ctx) => {
      try {
        await this.startAddFamilyMember(ctx);
      } catch (error) {
        console.error('Ошибка команды /addfamily:', error);
        await ctx.reply('Произошла ошибка при добавлении члена семьи.');
      }
    });

    this.bot.command('myhistory', async (ctx) => {
      try {
        await this.showVisitHistory(ctx);
      } catch (error) {
        console.error('Ошибка команды /myhistory:', error);
        await ctx.reply('Произошла ошибка при загрузке истории.');
      }
    });

    this.bot.command('changename', async (ctx) => {
      try {
        await this.startChangeName(ctx);
      } catch (error) {
        console.error('Ошибка команды /changename:', error);
        await ctx.reply('Произошла ошибка при изменении имени.');
      }
    });

    this.bot.command('changephone', async (ctx) => {
      try {
        await this.startChangePhone(ctx);
      } catch (error) {
        console.error('Ошибка команды /changephone:', error);
        await ctx.reply('Произошла ошибка при изменении телефона.');
      }
    });
  }

  async showProfile(ctx) {
    const userId = ctx.from.id.toString();
    const patient = patientsService.getPatient(userId);

    if (!patient) {
      await ctx.reply(
        '👤 Профиль не найден.\n\n' +
        'Чтобы создать профиль, нажмите "📅 Записаться" и пройдите процедуру записи.',
        Markup.keyboard([['📅 Записаться'], ['ℹ️ О клинике']]).resize()
      );
      return;
    }

    const lastVisit = patient.lastVisit 
      ? new Date(patient.lastVisit).toLocaleDateString('ru-RU')
      : 'ещё не было';

    const familyMembers = patient.familyMembers && patient.familyMembers.length > 0
      ? patient.familyMembers.map((member, index) => 
          `${index + 1}. ${member.relation} — ${member.name} (${member.phone})`
        ).join('\n')
      : 'нет';

    await ctx.reply(
      `👤 Ваш профиль:\n\n` +
      `📝 Имя: ${patient.name}\n` +
      `📞 Телефон: ${patient.phone}\n` +
      `📅 Зарегистрирован: ${new Date(patient.createdAt).toLocaleDateString('ru-RU')}\n` +
      `🏥 Визитов: ${patient.visitsCount}\n` +
      `📆 Последний визит: ${lastVisit}\n\n` +
      `👨‍👩‍👧‍👦 Члены семьи:\n${familyMembers}\n\n` +
      `💬 Медицинская информация:\n` +
      `• Постоянный пациент: ${patient.medicalHistory?.isReturningPatient ? '✅ Да' : '❌ Нет'}\n` +
      `• Последняя процедура: ${patient.medicalHistory?.lastProcedure || 'не указана'}\n\n` +
      `Доступные команды:\n` +
      `/addfamily — добавить члена семьи\n` +
      `/changename — изменить имя\n` +
      `/changephone — изменить телефон\n` +
      `/myhistory — история визитов`,
      undefined
    );
  }

  async startAddFamilyMember(ctx) {
    const userId = ctx.from.id.toString();
    const patient = patientsService.getPatient(userId);

    if (!patient) {
      await ctx.reply(
        'Сначала создайте профиль, нажав "📅 Записаться".',
        Markup.keyboard([['📅 Записаться']]).resize()
      );
      return;
    }

    this.userStates.set(userId, {
      state: 'adding_family_relation',
      patientData: patient
    });

    await ctx.reply(
      '👨‍👩‍👧‍👦 Добавление члена семьи\n\n' +
      'Укажите родственную связь (например: жена, сын, дочь, муж):',
      undefined
    );
  }

  async startChangeName(ctx) {
    const userId = ctx.from.id.toString();
    const patient = patientsService.getPatient(userId);

    if (!patient) {
      await ctx.reply(
        'Сначала создайте профиль, нажав "📅 Записаться".',
        Markup.keyboard([['📅 Записаться']]).resize()
      );
      return;
    }

    this.userStates.set(userId, {
      state: 'changing_name',
      patientData: patient
    });

    await ctx.reply(
      '📝 Изменение имени\n\n' +
      'Введите ваше новое имя:',
      undefined
    );
  }

  async startChangePhone(ctx) {
    const userId = ctx.from.id.toString();
    const patient = patientsService.getPatient(userId);

    if (!patient) {
      await ctx.reply(
        'Сначала создайте профиль, нажав "📅 Записаться".',
        Markup.keyboard([['📅 Записаться']]).resize()
      );
      return;
    }

    this.userStates.set(userId, {
      state: 'changing_phone',
      patientData: patient
    });

    await ctx.reply(
      '📞 Изменение телефона\n\n' +
      'Введите ваш новый номер телефона (формат: +7XXXXXXXXXX или 8XXXXXXXXXX):',
      undefined
    );
  }

  async showVisitHistory(ctx) {
    const userId = ctx.from.id.toString();
    const patient = patientsService.getPatient(userId);

    if (!patient) {
      await ctx.reply(
        'Сначала создайте профиль, нажав "📅 Записаться".',
        Markup.keyboard([['📅 Записаться']]).resize()
      );
      return;
    }

    try {
      const todayBookings = await calendarService.getTodayBookings();
      const weekBookings = await calendarService.getWeekBookings();

      const patientPhone = patientsService.normalizePhone(patient.phone);
      
      const patientEvents = [...todayBookings, ...weekBookings].filter(event => {
        const description = event.description || '';
        const phoneMatch = description.match(/Телефон:\s*(\+?\d[\d\s\-\(\)]+)/);
        if (!phoneMatch) return false;
        
        const eventPhone = patientsService.normalizePhone(phoneMatch[1]);
        return eventPhone === patientPhone;
      });

      if (patientEvents.length === 0) {
        await ctx.reply(
          '📋 История визитов:\n\n' +
          'Записей в календаре не найдено.\n\n' +
          `Всего визитов в профиле: ${patient.visitsCount}`,
          undefined
        );
        return;
      }

      const doctors = require('../../config/doctors.json');
      const history = patientEvents
        .sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date))
        .map((event, index) => {
          const date = new Date(event.start.dateTime || event.start.date);
          const procedure = event.summary || 'Не указано';
          const doctorMatch = event.description?.match(/doctor_id:\s*(\w+)/);
          const doctor = doctorMatch ? doctors.doctors.find(d => d.id === doctorMatch[1]) : null;
          const doctorInfo = doctor ? ` (${doctor.name})` : '';
          return `${index + 1}. ${date.toLocaleDateString('ru-RU')} — ${procedure}${doctorInfo}`;
        })
        .join('\n');

      await ctx.reply(
        `📋 История визитов:\n\n${history}\n\n` +
        `Всего визитов в профиле: ${patient.visitsCount}`,
        undefined
      );
    } catch (error) {
      console.error('Ошибка получения истории:', error);
      await ctx.reply(
        `📋 История визитов:\n\n` +
        `Не удалось загрузить записи из календаря.\n\n` +
        `Всего визитов в профиле: ${patient.visitsCount}`,
        undefined
      );
    }
  }

  setupBookingFlow() {
    this.bot.hears('📅 Записаться', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const patient = patientsService.getPatient(userId);
        
        if (patient) {
          await this.handleReturningPatient(ctx, patient);
        } else {
          await this.handleNewPatient(ctx);
        }
      } catch (error) {
        console.error('Ошибка в начале записи:', error);
        await ctx.reply(
          'Произошла ошибка при начале записи. Пожалуйста, попробуйте позже.'
        );
      }
    });

    this.bot.action(/record_self_(.+)/, async (ctx) => {
      try {
        const userId = ctx.match[1];
        const patient = patientsService.getPatient(userId);
        
        if (!patient) {
          await ctx.answerCbQuery('Профиль не найден');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          state: 'patient_qualification',
          patientId: userId,
          patientData: patient,
          recordingForSelf: true,
          isReturningPatient: patient.medicalHistory?.isReturningPatient || false
        });

        await ctx.editMessageText(
          `👋 Здравствуйте, ${patient.name}!\n\n` +
          `Вы уже проходили лечение в нашей клинике?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Да, я ваш постоянный пациент', 'qualification_yes')],
            [Markup.button.callback('❌ Нет, впервые', 'qualification_no')]
          ])
        );
      } catch (error) {
        console.error('Ошибка выбора записи для себя:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/record_family_(.+)_(\d+)/, async (ctx) => {
      try {
        const [_, userId, memberIndex] = ctx.match;
        const patient = patientsService.getPatient(userId);
        
        if (!patient || !patient.familyMembers || !patient.familyMembers[memberIndex]) {
          await ctx.answerCbQuery('Член семьи не найден');
          return;
        }

        const familyMember = patient.familyMembers[memberIndex];

        this.userStates.set(ctx.chat.id, {
          state: 'patient_qualification',
          patientId: userId,
          patientData: patient,
          familyMemberIndex: parseInt(memberIndex),
          familyMemberData: familyMember,
          recordingForSelf: false,
          recordingForFamily: true
        });

        await ctx.editMessageText(
          `👋 Записываем ${familyMember.relation} ${familyMember.name}\n\n` +
          `${familyMember.name} уже проходил(а) лечение в нашей клинике?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Да, постоянный пациент', 'qualification_yes')],
            [Markup.button.callback('❌ Нет, впервые', 'qualification_no')]
          ])
        );
      } catch (error) {
        console.error('Ошибка выбора записи для семьи:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('add_new_family_member', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        this.userStates.set(ctx.chat.id, {
          state: 'adding_family_for_booking',
          patientId: userId
        });

        await ctx.editMessageText(
          '👨‍👩‍👧‍👦 Добавление члена семьи для записи\n\n' +
          'Укажите родственную связь (например: жена, сын, дочь, муж):',
          undefined
        );
      } catch (error) {
        console.error('Ошибка добавления члена семьи:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('qualification_yes', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'returning_patient_choice',
          isReturningPatient: true
        });

        await ctx.editMessageText(
          'Отлично! Что у вас сейчас?',
          Markup.inlineKeyboard([
            [Markup.button.callback('🚨 Острая боль/срочная проблема', 'problem_urgent')],
            [Markup.button.callback('🦷 Плановая коррекция/продолжение лечения', 'problem_planned')],
            [Markup.button.callback('🔍 Новая проблема', 'problem_new')],
            [Markup.button.callback('💬 Другое — хочу описать', 'problem_other')]
          ])
        );
      } catch (error) {
        console.error('Ошибка квалификации "Да":', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('qualification_no', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_procedure',
          isReturningPatient: false
        });

        await this.showProcedureSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка квалификации "Нет":', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_urgent', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'urgent_description',
          priority: 'urgent',
          problemType: 'urgent'
        });

        await ctx.editMessageText(
          '🚨 Понял! Это срочно — примем вас ВНЕ ОЧЕРЕДИ.\n\n' +
          'Опишите что случилось (кратко):',
          undefined
        );
      } catch (error) {
        console.error('Ошибка выбора срочной проблемы:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_planned', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'planned_description',
          priority: 'normal',
          problemType: 'planned'
        });

        await ctx.editMessageText(
          '🦷 Понял, плановый визит. Опишите кратко что корректируем (необязательно):',
          undefined
        );
      } catch (error) {
        console.error('Ошибка выбора плановой проблемы:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_new', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_procedure',
          priority: 'normal',
          problemType: 'new'
        });

        await this.showProcedureSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора новой проблемы:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_other', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'other_description',
          priority: 'normal',
          problemType: 'other'
        });

        await ctx.editMessageText(
          '💬 Опишите ваш случай:',
          undefined
        );
      } catch (error) {
        console.error('Ошибка выбора "другое":', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/procedure_(.+)/, async (ctx) => {
      try {
        const procedureId = ctx.match[1];
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_doctor',
          selectedProcedure: procedureId
        });

        await this.showDoctorSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора процедуры:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/urgent_procedure_(.+)/, async (ctx) => {
      try {
        const procedureId = ctx.match[1];
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_doctor',
          selectedProcedure: procedureId,
          urgentProcedureType: procedureId
        });

        await this.showDoctorSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора срочной процедуры:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/doctor_(.+)/, async (ctx) => {
      try {
        const doctorId = ctx.match[1];
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_date',
          selectedDoctor: doctorId
        });

        await this.showDateSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора врача:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('doctor_any', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_date',
          selectedDoctor: 'any'
        });

        await this.showDateSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора любого свободного врача:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/date_(.+)/, async (ctx) => {
      try {
        const dateStr = ctx.match[1];
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const selectedDate = new Date(dateStr);
        
        await ctx.editMessageText(
          `🔍 Ищу свободные окна на ${selectedDate.toLocaleDateString('ru-RU')}...`
        );

        const doctorId = userState.selectedDoctor || 'any';
        const freeSlots = await calendarService.getFreeSlots(selectedDate, doctorId);
        
        if (freeSlots.slots.length === 0) {
          const nextAvailable = await calendarService.findNextAvailableSlots(selectedDate, doctorId);
          
          if (nextAvailable.length > 0) {
            let message = `🤖 На ${selectedDate.toLocaleDateString('ru-RU')} все окна заняты. Ближайшие свободные:\n\n`;
            
            const buttons = [];
            
            nextAvailable.forEach(day => {
              if (day.slots.length > 0) {
                day.slots.forEach(slot => {
                  buttons.push([
                    Markup.button.callback(
                      `${day.dateFormatted} — ${slot.formatted}`,
                      `time_${day.date}_${slot.formatted}`
                    )
                  ]);
                });
              }
            });
            
            await ctx.editMessageText(
              message,
              Markup.inlineKeyboard(buttons)
            );
            
            this.userStates.set(ctx.chat.id, {
              ...userState,
              availableDays: nextAvailable
            });
          } else {
            await ctx.editMessageText(
              `На ${selectedDate.toLocaleDateString('ru-RU')} нет свободных окон.\n\n` +
              `Пожалуйста, выберите другую дата:`,
              Markup.inlineKeyboard([
                [Markup.button.callback('Выбрать другую дату', 'choose_date')]
              ])
            );
          }
          return;
        }

        const timeParts = this.groupSlotsByTimePart(freeSlots.slots);
        const buttons = [];

        if (timeParts.morning.length > 0) {
          buttons.push([Markup.button.callback(`🌅 Утро (${timeParts.morning.length})`, `timepart_${dateStr}_morning`)]);
        }
        if (timeParts.day.length > 0) {
          buttons.push([Markup.button.callback(`☀️ День (${timeParts.day.length})`, `timepart_${dateStr}_day`)]);
        }
        if (timeParts.evening.length > 0) {
          buttons.push([Markup.button.callback(`🌆 Вечер (${timeParts.evening.length})`, `timepart_${dateStr}_evening`)]);
        }

        buttons.push([Markup.button.callback('Выбрать другую дату', 'choose_date')]);

        await ctx.editMessageText(
          `📅 На ${selectedDate.toLocaleDateString('ru-RU')} свободно ${freeSlots.slots.length} окон:\n\n` +
          `Выберите часть дня:`,
          Markup.inlineKeyboard(buttons)
        );

        this.userStates.set(ctx.chat.id, {
          ...userState,
          selectedDate: dateStr,
          availableSlots: freeSlots.slots,
          freeDoctorsBySlot: freeSlots.freeDoctorsBySlot,
          timeParts: timeParts
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

    this.bot.action(/timepart_(.+)_(.+)/, async (ctx) => {
      try {
        const [_, dateStr, timePart] = ctx.match;
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const slots = userState.timeParts[timePart] || [];
        
        if (slots.length === 0) {
          await ctx.answerCbQuery('Нет свободных окон в этой части дня');
          return;
        }

        const buttons = [];
        for (let i = 0; i < slots.length; i += 3) {
          const row = slots.slice(i, i + 3).map(slot => 
            Markup.button.callback(
              slot.formatted,
              `time_${dateStr}_${slot.formatted}`
            )
          );
          buttons.push(row);
        }

        buttons.push([Markup.button.callback('↩️ Назад', 'choose_date')]);

        const timePartNames = {
          morning: 'утро (09:00-12:00)',
          day: 'день (12:00-17:00)',
          evening: 'вечер (17:00-20:00)'
        };

        await ctx.editMessageText(
          `⏰ Доступные окна на ${new Date(dateStr).toLocaleDateString('ru-RU')}, ${timePartNames[timePart]}:`,
          Markup.inlineKeyboard(buttons)
        );
      } catch (error) {
        console.error('Ошибка выбора части дня:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/time_(.+)_(.+)/, async (ctx) => {
      try {
        const [_, dateStr, timeStr] = ctx.match;
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const slot = userState.availableSlots.find(s => s.formatted === timeStr);
        const freeDoctors = slot?.freeDoctors || [];

        if (userState.selectedDoctor === 'any' && freeDoctors.length > 1) {
          if (freeDoctors.length === 1) {
            this.userStates.set(ctx.chat.id, {
              ...userState,
              state: 'entering_name',
              selectedDate: dateStr,
              selectedTime: timeStr,
              selectedDoctor: freeDoctors[0]
            });

            const patientName = userState.recordingForFamily 
              ? userState.familyMemberData.name 
              : userState.patientData?.name || '';

            if (patientName) {
              this.userStates.set(ctx.chat.id, {
                ...userState,
                state: 'entering_phone',
                selectedDate: dateStr,
                selectedTime: timeStr,
                selectedDoctor: freeDoctors[0],
                patientName: patientName
              });

              await ctx.editMessageText(
                `Отлично! Теперь введите номер телефона ${patientName}:\n` +
                `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`,
                undefined
              );
            } else {
              await ctx.editMessageText(
                'Введите ваше имя:',
                undefined
              );
            }
          } else {
            const doctors = require('../../config/doctors.json');
            const doctorButtons = freeDoctors.map(doctorId => {
              const doctor = doctors.doctors.find(d => d.id === doctorId);
              return [Markup.button.callback(
                doctor ? doctor.name : doctorId,
                `final_doctor_${dateStr}_${timeStr}_${doctorId}`
              )];
            });

            await ctx.editMessageText(
              `⏰ Выбранное время: ${timeStr}\n\n` +
              `К кому из свободных врачей записать?`,
              Markup.inlineKeyboard(doctorButtons)
            );
          }
        } else {
          this.userStates.set(ctx.chat.id, {
            ...userState,
            state: 'entering_name',
            selectedDate: dateStr,
            selectedTime: timeStr
          });

          const patientName = userState.recordingForFamily 
            ? userState.familyMemberData.name 
            : userState.patientData?.name || '';

          if (patientName) {
            this.userStates.set(ctx.chat.id, {
              ...userState,
              state: 'entering_phone',
              selectedDate: dateStr,
              selectedTime: timeStr,
              patientName: patientName
            });

            await ctx.editMessageText(
              `Отлично! Теперь введите номер телефона ${patientName}:\n` +
              `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`,
              undefined
            );
          } else {
            await ctx.editMessageText(
              'Введите ваше имя:',
              undefined
            );
          }
        }
      } catch (error) {
        console.error('Ошибка выбора времени:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/final_doctor_(.+)_(.+)_(.+)/, async (ctx) => {
      try {
        const [_, dateStr, timeStr, doctorId] = ctx.match;
        const userState = this.userStates.get(ctx.chat.id);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'entering_name',
          selectedDate: dateStr,
          selectedTime: timeStr,
          selectedDoctor: doctorId
        });

        const patientName = userState.recordingForFamily 
          ? userState.familyMemberData.name 
          : userState.patientData?.name || '';

        if (patientName) {
          this.userStates.set(ctx.chat.id, {
            ...userState,
            state: 'entering_phone',
            selectedDate: dateStr,
            selectedTime: timeStr,
            selectedDoctor: doctorId,
            patientName: patientName
          });

          await ctx.editMessageText(
            `Отлично! Теперь введите номер телефона ${patientName}:\n` +
            `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`,
            undefined
          );
        } else {
          await ctx.editMessageText(
            'Введите ваше имя:',
            undefined
          );
        }
      } catch (error) {
        console.error('Ошибка выбора врача из списка:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.on('text', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState) {
          return;
        }

        const text = ctx.message.text;

        switch (userState.state) {
          case 'new_patient_name':
            await this.handleNewPatientName(ctx, text, userState);
            break;
          case 'new_patient_phone':
            await this.handleNewPatientPhone(ctx, text, userState);
            break;
          case 'adding_family_relation':
            await this.handleFamilyRelation(ctx, text, userState);
            break;
          case 'adding_family_name':
            await this.handleFamilyName(ctx, text, userState);
            break;
          case 'adding_family_phone':
            await this.handleFamilyPhone(ctx, text, userState);
            break;
          case 'adding_family_for_booking':
            await this.handleFamilyForBookingRelation(ctx, text, userState);
            break;
          case 'adding_family_for_booking_name':
            await this.handleFamilyForBookingName(ctx, text, userState);
            break;
          case 'adding_family_for_booking_phone':
            await this.handleFamilyForBookingPhone(ctx, text, userState);
            break;
          case 'changing_name':
            await this.handleChangeName(ctx, text, userState);
            break;
          case 'changing_phone':
            await this.handleChangePhone(ctx, text, userState);
            break;
          case 'urgent_description':
          case 'planned_description':
          case 'new_problem_description':
          case 'other_description':
            await this.handleProblemDescription(ctx, text, userState);
            break;
          case 'entering_name':
            await this.handleBookingName(ctx, text, userState);
            break;
          case 'entering_phone':
            await this.handleBookingPhone(ctx, text, userState);
            break;
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

        const patientName = userState.recordingForFamily 
          ? userState.familyMemberData.name 
          : userState.patientName;

        const actualDoctorId = userState.selectedDoctor === 'any' 
          ? (userState.availableSlots.find(s => s.formatted === userState.selectedTime)?.freeDoctors[0] || null)
          : userState.selectedDoctor;

        const bookingResult = await calendarService.createBooking(
          userState.selectedDate,
          userState.selectedTime,
          {
            name: patientName,
            phone: userState.patientPhone,
            priority: userState.priority || 'normal',
            problemDescription: userState.problemDescription || '',
            isReturningPatient: userState.isReturningPatient || false
          },
          userState.selectedProcedure || 'other_urgent',
          actualDoctorId
        );

        if (bookingResult.success) {
          const userId = userState.recordingForSelf ? userState.patientId : ctx.chat.id.toString();
          
          if (userState.recordingForSelf) {
            await patientsService.incrementVisitsCount(userId, {
              procedure: userState.selectedProcedure,
              notes: userState.problemDescription || ''
            });
          }

          await this.notifyAdminBooking(userState, patientName, userState.patientPhone);
          
          const doctors = require('../../config/doctors.json');
          const doctor = actualDoctorId ? doctors.doctors.find(d => d.id === actualDoctorId) : null;

          await ctx.editMessageText(
            `✅ Запись успешно создана!\n\n` +
            `Ваша запись подтверждена на:\n` +
            `📅 ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')} в ${userState.selectedTime}\n` +
            `👨‍⚕️ ${doctor ? doctor.name : 'Врач'}\n\n` +
            `Мы ждём вас в клинике!\n\n` +
            `Если у вас есть вопросы, нажмите "💬 Задать вопрос".`
          );

          this.userStates.delete(ctx.chat.id);
        } else if (bookingResult.error === 'slot_busy') {
          await ctx.editMessageText(
            '😔 Извините, это время только что заняли. Вот другие свободные окна:',
            Markup.inlineKeyboard(
              userState.availableSlots
                .filter(slot => slot.formatted !== userState.selectedTime)
                .slice(0, 5)
                .map(slot => [
                  Markup.button.callback(
                    `${slot.formatted}`,
                    `time_${userState.selectedDate}_${slot.formatted}`
                  )
                ])
            )
          );
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

    this.bot.action('choose_date', async (ctx) => {
      try {
        const userState = this.userStates.get(ctx.chat.id);
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        await this.showDateSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора другой даты:', error);
        await ctx.answerCbQuery('Произошла ошибка');
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

  async showProcedureSelection(ctx, userState) {
    try {
      if (userState.priority === 'urgent') {
        await this.showUrgentProcedures(ctx, userState);
      } else {
        await this.showAllProcedures(ctx, userState);
      }
    } catch (error) {
      console.error('Ошибка показа процедур:', error);
      await ctx.editMessageText(
        'Произошла ошибка при загрузке процедур. Пожалуйста, попробуйте позже.'
      );
    }
  }

  async showUrgentProcedures(ctx, userState) {
    const urgentProcedures = [
      { id: 'acute_pain', title: '🦷 Острая зубная боль' },
      { id: 'broken_appliance', title: '🔧 Сломался протез/брекет' },
      { id: 'bleeding', title: '🩸 Кровотечение' },
      { id: 'other_urgent', title: '💬 Другое — опишу врачу' }
    ];

    const buttons = urgentProcedures.map(proc => 
      [Markup.button.callback(proc.title, `urgent_procedure_${proc.id}`)]
    );

    await ctx.editMessageText(
      '🚨 Выберите тип проблемы (срочная запись):',
      Markup.inlineKeyboard(buttons)
    );
  }

  async showAllProcedures(ctx, userState) {
    const procedures = aiService.getProcedures();
    
    const buttons = procedures.map(proc => 
      [Markup.button.callback(
        `${proc.название} — ${proc.цена}`, 
        `procedure_${proc.id}`
      )]
    );

    await ctx.editMessageText(
      '📅 Выберите процедуру:',
      Markup.inlineKeyboard(buttons)
    );
  }

  async showDoctorSelection(ctx, userState) {
    try {
      const doctors = require('../../config/doctors.json');
      
      if (doctors.doctors.length === 1) {
        const singleDoctor = doctors.doctors[0];
        this.userStates.set(ctx.chat.id, {
          ...userState,
          state: 'choose_date',
          selectedDoctor: singleDoctor.id
        });

        await ctx.editMessageText(
          `Записываем к ${singleDoctor.name} (${singleDoctor.specialty}).\n\n` +
          'Выберите дата:',
          Markup.inlineKeyboard([
            [Markup.button.callback('📅 Выбрать дата', 'choose_date')]
          ])
        );
        return;
      }

      const buttons = doctors.doctors.map(doctor => 
        [Markup.button.callback(
          `${doctor.name} — ${doctor.specialty}`,
          `doctor_${doctor.id}`
        )]
      );

      buttons.push([Markup.button.callback('🎲 Любой свободный', 'doctor_any')]);

      await ctx.editMessageText(
        '🤔 К какому врачу запишем?',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      console.error('Ошибка показа выбора врача:', error);
      await ctx.editMessageText(
        'Произошла ошибка при загрузке врачей. Пожалуйста, попробуйте позже.'
      );
    }
  }

  async showDateSelection(ctx, userState) {
    try {
      const schedule = require('../config/schedule.json');
      const today = new Date();
      const buttons = [];

      for (let i = 0; i < schedule.bookingDaysAhead; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        if (schedule.daysOff.includes(dayOfWeek)) {
          continue;
        }

        const dateStr = date.toISOString().split('T')[0];
        const dateLabel = i === 0 ? 'Сегодня' : 
                         i === 1 ? 'Завтра' : 
                         date.toLocaleDateString('ru-RU');

        buttons.push([
          Markup.button.callback(dateLabel, `date_${dateStr}`)
        ]);
      }

      await ctx.editMessageText(
        '📅 Выберите дата:',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      console.error('Ошибка показа выбора даты:', error);
      await ctx.editMessageText(
        'Произошла ошибка при загрузке дат. Пожалуйста, попробуйте позже.'
      );
    }
  }

  groupSlotsByTimePart(slots) {
    const morning = [];
    const day = [];
    const evening = [];

    slots.forEach(slot => {
      const hour = slot.start.getHours();
      
      if (hour >= 9 && hour < 12) {
        morning.push(slot);
      } else if (hour >= 12 && hour < 17) {
        day.push(slot);
      } else if (hour >= 17 && hour < 20) {
        evening.push(slot);
      }
    });

    return { morning, day, evening };
  }

  async handleNewPatient(ctx) {
    const userId = ctx.from.id.toString();
    
    this.userStates.set(userId, {
      state: 'new_patient_name'
    });

    await ctx.reply(
      '👤 Новый пациент\n\n' +
      'Введите ваше имя:',
      undefined
    );
  }

  async handleReturningPatient(ctx, patient) {
    const userId = ctx.from.id.toString();
    
    const lastVisit = patient.lastVisit 
      ? new Date(patient.lastVisit).toLocaleDateString('ru-RU')
      : 'ещё не было';

    const familyButtons = [];
    
    if (patient.familyMembers && patient.familyMembers.length > 0) {
      patient.familyMembers.forEach((member, index) => {
        familyButtons.push([
          Markup.button.callback(
            `👨‍👩‍👧‍👦 ${member.relation} — ${member.name}`,
            `record_family_${userId}_${index}`
          )
        ]);
      });
    }

    const buttons = [
      [Markup.button.callback(`👤 Себя (${patient.name})`, `record_self_${userId}`)],
      ...familyButtons,
      [Markup.button.callback('➕ Добавить члена семьи', 'add_new_family_member')]
    ];

    await ctx.reply(
      `👋 Здравствуйте, ${patient.name}! Рады видеть вас снова!\n\n` +
      `Вы были у нас ${patient.visitsCount} раз, последний визит: ${lastVisit}.\n\n` +
      `Кого будем записывать?`,
      Markup.inlineKeyboard(buttons)
    );
  }

  async handleNewPatientName(ctx, name, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'new_patient_phone',
      patientName: name.trim()
    });

    await ctx.reply(
      `Отлично, ${name.trim()}! Теперь введите ваш номер телефона:\n` +
      `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`
    );
  }

  async handleNewPatientPhone(ctx, phone, userState) {
    const userId = ctx.chat.id.toString();
    const phoneRegex = /^(\+7|8)\d{10}$/;
    
    if (!phoneRegex.test(phone)) {
      await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
      return;
    }

    const formattedPhone = phone.startsWith('8') ? '+7' + phone.slice(1) : phone;
    
    try {
      await patientsService.savePatient(userId, {
        name: userState.patientName,
        phone: formattedPhone,
        createdAt: new Date().toISOString()
      });

      await ctx.reply(
        '✅ Спасибо! Сохранили ваши данные.\n\n' +
        'Теперь выберите, для кого запись:',
        Markup.inlineKeyboard([
          [Markup.button.callback(`👤 Себя (${userState.patientName})`, `record_self_${userId}`)],
          [Markup.button.callback('➕ Добавить члена семьи', 'add_new_family_member')]
        ])
      );

      this.userStates.delete(userId);
    } catch (error) {
      console.error('Ошибка сохранения пациента:', error);
      await ctx.reply('Произошла ошибка при сохранении данных. Пожалуйста, попробуйте снова.');
    }
  }

  async handleFamilyRelation(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'adding_family_name',
      newFamilyMember: {
        relation: text.trim()
      }
    });

    await ctx.reply(
      `Введите имя ${text.trim()}:`
    );
  }

  async handleFamilyName(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'adding_family_phone',
      newFamilyMember: {
        ...userState.newFamilyMember,
        name: text.trim()
      }
    });

    await ctx.reply(
      `Введите номер телефона ${text.trim()}:\n` +
      `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`
    );
  }

  async handleFamilyPhone(ctx, phone, userState) {
    const userId = ctx.chat.id.toString();
    const phoneRegex = /^(\+7|8)\d{10}$/;
    
    if (!phoneRegex.test(phone)) {
      await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
      return;
    }

    const formattedPhone = phone.startsWith('8') ? '+7' + phone.slice(1) : phone;
    
    try {
      const newMember = await patientsService.addFamilyMember(userId, {
        relation: userState.newFamilyMember.relation,
        name: userState.newFamilyMember.name,
        phone: formattedPhone
      });

      await ctx.reply(
        `✅ ${userState.newFamilyMember.relation} ${userState.newFamilyMember.name} добавлен(а) в вашу семью!\n\n` +
        `Теперь вы можете записать ${userState.newFamilyMember.name} на приём.`,
        Markup.keyboard([['📅 Записаться'], ['👤 Мой профиль']]).resize()
      );

      this.userStates.delete(userId);
    } catch (error) {
      console.error('Ошибка добавления члена семьи:', error);
      await ctx.reply('Произошла ошибка при добавлении члена семьи. Пожалуйста, попробуйте снова.');
    }
  }

  async handleFamilyForBookingRelation(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'adding_family_for_booking_name',
      newFamilyMember: {
        relation: text.trim()
      }
    });

    await ctx.reply(
      `Введите имя ${text.trim()}:`
    );
  }

  async handleFamilyForBookingName(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'adding_family_for_booking_phone',
      newFamilyMember: {
        ...userState.newFamilyMember,
        name: text.trim()
      }
    });

    await ctx.reply(
      `Введите номер телефона ${text.trim()}:\n` +
      `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`
    );
  }

  async handleFamilyForBookingPhone(ctx, phone, userState) {
    const userId = ctx.chat.id.toString();
    const phoneRegex = /^(\+7|8)\d{10}$/;
    
    if (!phoneRegex.test(phone)) {
      await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
      return;
    }

    const formattedPhone = phone.startsWith('8') ? '+7' + phone.slice(1) : phone;
    
    try {
      const newMember = await patientsService.addFamilyMember(userId, {
        relation: userState.newFamilyMember.relation,
        name: userState.newFamilyMember.name,
        phone: formattedPhone
      });

      const patient = patientsService.getPatient(userId);
      
      this.userStates.set(userId, {
        state: 'patient_qualification',
        patientId: userId,
        patientData: patient,
        familyMemberIndex: patient.familyMembers.length - 1,
        familyMemberData: newMember,
        recordingForSelf: false,
        recordingForFamily: true
      });

      await ctx.reply(
        `✅ ${newMember.relation} ${newMember.name} добавлен(а)!\n\n` +
        `${newMember.name} уже проходил(а) лечение в нашей клинике?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, постоянный пациент', 'qualification_yes')],
          [Markup.button.callback('❌ Нет, впервые', 'qualification_no')]
        ])
      );
    } catch (error) {
      console.error('Ошибка добавления члена семьи для записи:', error);
      await ctx.reply('Произошла ошибка при добавлении члена семьи. Пожалуйста, попробуйте снова.');
    }
  }

  async handleChangeName(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    try {
      await patientsService.updatePatient(userId, {
        name: text.trim()
      });

      await ctx.reply(
        `✅ Имя успешно изменено на "${text.trim()}"!`,
        Markup.keyboard([['📅 Записаться'], ['👤 Мой профиль']]).resize()
      );

      this.userStates.delete(userId);
    } catch (error) {
      console.error('Ошибка изменения имени:', error);
      await ctx.reply('Произошла ошибка при изменении имени. Пожалуйста, попробуйте снова.');
    }
  }

  async handleChangePhone(ctx, phone, userState) {
    const userId = ctx.chat.id.toString();
    const phoneRegex = /^(\+7|8)\d{10}$/;
    
    if (!phoneRegex.test(phone)) {
      await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
      return;
    }

    const formattedPhone = phone.startsWith('8') ? '+7' + phone.slice(1) : phone;
    
    try {
      await patientsService.updatePatient(userId, {
        phone: formattedPhone
      });

      await ctx.reply(
        `✅ Телефон успешно изменен на "${formattedPhone}"!`,
        Markup.keyboard([['📅 Записаться'], ['👤 Мой профиль']]).resize()
      );

      this.userStates.delete(userId);
    } catch (error) {
      console.error('Ошибка изменения телефона:', error);
      await ctx.reply('Произошла ошибка при изменении телефона. Пожалуйста, попробуйте снова.');
    }
  }

  async handleProblemDescription(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'choose_procedure',
      problemDescription: text.trim()
    });

    await this.showProcedureSelection(ctx, userState);
  }

  async handleBookingName(ctx, text, userState) {
    const userId = ctx.chat.id.toString();
    
    this.userStates.set(userId, {
      ...userState,
      state: 'entering_phone',
      patientName: text.trim()
    });

    await ctx.reply(
      `Отлично, ${text.trim()}! Теперь введите номер телефона:\n` +
      `(формат: +7XXXXXXXXXX или 8XXXXXXXXXX)`
    );
  }

  async handleBookingPhone(ctx, phone, userState) {
    const userId = ctx.chat.id.toString();
    const phoneRegex = /^(\+7|8)\d{10}$/;
    
    if (!phoneRegex.test(phone)) {
      await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
      return;
    }

    const formattedPhone = phone.startsWith('8') ? '+7' + phone.slice(1) : phone;
    
    this.userStates.set(userId, {
      ...userState,
      state: 'confirming_booking',
      patientPhone: formattedPhone
    });

    const patientName = userState.recordingForFamily 
      ? userState.familyMemberData.name 
      : userState.patientName;

    const doctors = require('../../config/doctors.json');
    const doctor = userState.selectedDoctor ? doctors.doctors.find(d => d.id === userState.selectedDoctor) : null;

    const procedureName = userState.selectedProcedure 
      ? (userState.selectedProcedure === 'acute_pain' ? 'Острая зубная боль' :
         userState.selectedProcedure === 'broken_appliance' ? 'Сломался протез/брекет' :
         userState.selectedProcedure === 'bleeding' ? 'Кровотечение' :
         userState.selectedProcedure === 'other_urgent' ? 'Другая срочная проблема' :
         aiService.getProcedureById(userState.selectedProcedure)?.название)
      : 'Не указано';

    await ctx.reply(
      `📋 Проверьте данные записи:\n\n` +
      `👤 Пациент: ${patientName}\n` +
      `📞 Телефон: ${formattedPhone}\n` +
      `📅 Дата: ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')}\n` +
      `⏰ Время: ${userState.selectedTime}\n` +
      (doctor ? `👨‍⚕️ Врач: ${doctor.name} (${doctor.specialty})\n` : '') +
      (userState.priority === 'urgent' ? `🚨 Тип: Срочная запись (ВНЕ ОЧЕРЕДИ)\n` : '') +
      (userState.problemDescription ? `💬 Описание: ${userState.problemDescription}\n` : '') +
      (procedureName !== 'Не указано' ? `🦷 Процедура: ${procedureName}\n` : '') +
      `Всё верно?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Да, записать', 'confirm_booking'),
          Markup.button.callback('❌ Нет, исправить', 'cancel_booking')
        ]
      ])
    );
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
        } else if (!userState || ![
          'new_patient_name', 'new_patient_phone',
          'adding_family_relation', 'adding_family_name', 'adding_family_phone',
          'adding_family_for_booking', 'adding_family_for_booking_name', 'adding_family_for_booking_phone',
          'changing_name', 'changing_phone',
          'urgent_description', 'planned_description', 'new_problem_description', 'other_description',
          'entering_name', 'entering_phone'
        ].includes(userState.state)) {
          if (ctx.message.text !== '📅 Записаться' && 
              ctx.message.text !== '💬 Задать вопрос' && 
              ctx.message.text !== 'ℹ️ О клинике' &&
              ctx.message.text !== '👤 Мой профиль') {
            
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

        const stats = await patientsService.getPatientStats();

        const revenue = weekBookings.reduce((sum, event) => {
          const match = event.summary?.match(/— (\d+)₽/);
          if (match) {
            return sum + parseInt(match[1]);
          }
          return sum;
        }, 0);

        await ctx.reply(
          `📊 Статистика клиники:\n\n` +
          `📅 Записи:\n` +
          `• Сегодня: ${todayCount} записей\n` +
          `• За неделю: ${weekCount} записей\n` +
          `• Оборот: ${revenue}₽\n\n` +
          `👥 Пациенты:\n` +
          `• Всего: ${stats.total}\n` +
          `• Постоянных: ${stats.returning}\n` +
          `• Новых: ${stats.new}\n` +
          `• Среднее визитов: ${stats.averageVisits.toFixed(1)}\n\n` +
          `Подробности в Google Calendar.`
        );
      } catch (error) {
        console.error('Ошибка команды /stats:', error);
        await ctx.reply('Ошибка при получении статистики.');
      }
    });
  }

  async notifyAdminBooking(userState, patientName, phone) {
    try {
      if (!process.env.ADMIN_CHAT_ID) return;

      const doctors = require('../../config/doctors.json');
      const doctor = userState.selectedDoctor ? doctors.doctors.find(d => d.id === userState.selectedDoctor) : null;

      const procedureName = userState.selectedProcedure 
        ? (userState.selectedProcedure === 'acute_pain' ? 'Острая зубная боль' :
           userState.selectedProcedure === 'broken_appliance' ? 'Сломался протез/брекет' :
           userState.selectedProcedure === 'bleeding' ? 'Кровотечение' :
           userState.selectedProcedure === 'other_urgent' ? 'Другая срочная проблема' :
           aiService.getProcedureById(userState.selectedProcedure)?.название)
        : 'Не указано';

      let message = '';
      
      if (userState.priority === 'urgent') {
        message = `🚨 СРОЧНАЯ ЗАПИСЬ!\n\n` +
          `👤 ${patientName} (${phone})\n` +
          `📅 ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')} в ${userState.selectedTime}\n` +
          `🦷 ${procedureName}\n`;
          
        if (doctor) {
          message += `👨‍⚕️ ${doctor.name}\n`;
        }
        
        if (userState.problemDescription) {
          message += `💬 "${userState.problemDescription}"\n`;
        }
        
        message += `\n⚠️ ВНЕ ОЧЕРЕДИ — принять немедленно!`;
      } else if (userState.isReturningPatient && userState.problemType === 'planned') {
        const patient = patientsService.getPatient(userState.patientId);
        message = `🆕 Новая запись\n\n` +
          `👤 ${patientName} (${phone})\n` +
          `📅 ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')} в ${userState.selectedTime}\n` +
          `🦷 ${procedureName}\n`;
          
        if (doctor) {
          message += `👨‍⚕️ ${doctor.name}\n`;
        }
        
        if (userState.problemDescription) {
          message += `💬 "${userState.problemDescription}"\n`;
        }
        
        if (patient) {
          message += `📊 Визитов: ${patient.visitsCount + 1} (постоянный пациент)`;
        }
      } else {
        message = `🆕 Новая запись\n\n` +
          `👤 ${patientName} (${phone})\n` +
          `📅 ${new Date(userState.selectedDate).toLocaleDateString('ru-RU')} в ${userState.selectedTime}\n` +
          `🦷 ${procedureName}\n`;
          
        if (doctor) {
          message += `👨‍⚕️ ${doctor.name}\n`;
        }
        
        if (userState.problemDescription) {
          message += `💬 "${userState.problemDescription}"\n`;
        }
        
        if (userState.isReturningPatient) {
          const patient = patientsService.getPatient(userState.patientId);
          if (patient) {
            message += `📊 Визитов: ${patient.visitsCount + 1} (постоянный пациент)`;
          }
        }
      }

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
      for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await this.bot.launch();
    break;
  } catch (err) {
    const is409 = String(err.message).includes('409');
    if (is409 && attempt < 5) {
      console.log(`⚠️ Конфликт polling (попытка ${attempt}). Жду 10 сек...`);
      await new Promise(r => setTimeout(r, 10000));
    } else {
      throw err;
    }
  }
}
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