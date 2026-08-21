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
    this.bot.on('text', async (ctx, next) => {
      try {
        const chatId = ctx.chat.id.toString();
        const text = (ctx.message.text || '').trim();
        
        if (text.startsWith('/') || ['📅 Записаться', '💬 Задать вопрос', '👤 Мой профиль', 'ℹ️ Информация', '🏠 Главное меню'].includes(text)) {
          this.userStates.delete(chatId);
          return await next();
        }

        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || !userState.state) {
          return await next();
        }
        
        if (['📅 Записаться', '💬 Задать вопрос', 'ℹ️ О клинике', '👤 Мой профиль'].includes(text)) {
          return await next();
        }

        switch (userState.state) {
          case 'awaiting_name':
            await this.handleAwaitingName(ctx, text, userState);
            break;
          case 'awaiting_name_other':
            await this.handleAwaitingNameOther(ctx, text, userState);
            break;
          case 'awaiting_phone':
            await this.handleAwaitingPhone(ctx, text, userState);
            break;
          case 'describe_routine':
            await this.handleDescribeRoutine(ctx, text, userState);
            break;
          case 'describe_problem':
            await this.handleDescribeProblem(ctx, text, userState);
            break;
        }
      } catch (error) {
        console.error('Ошибка обработки текста:', error);
      }
    });

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
        this.userStates.delete(ctx.chat.id.toString());
        await ctx.reply(
          '👋 Добро пожаловать в стоматологическую клинику!\n\n' +
          'Я помогу вам:\n' +
          '• 📅 Записаться на процедуру\n' +
          '• 💬 Получить консультацию\n' +
          '• ℹ️ Узнать информацию о услугах\n' +
          '• 👤 Управление профилем\n\n' +
          'Выберите действие:\n' +
          'Если кнопки пропали — напиши /menu',
          Markup.keyboard([
            ['📅 Записаться', '🏠 Главное меню'],
            ['💬 Задать вопрос'],
            ['ℹ️ О клинике'],
            ['👤 Мой профиль']
          ]).resize()
        );
      } catch (error) {
        console.error('Ошибка в команде /start:', error);
      }
    });

    this.bot.command('menu', async (ctx) => {
      try {
        this.userStates.delete(ctx.chat.id.toString());
        await ctx.reply(
          'Главное меню:\n\n' +
          'Я помогу вам:\n' +
          '• 📅 Записаться на процедуру\n' +
          '• 💬 Получить консультацию\n' +
          '• ℹ️ Узнать информацию о услугах\n' +
          '• 👤 Управление профилем\n\n' +
          'Выберите действие:',
          Markup.keyboard([
            ['📅 Записаться', '🏠 Главное меню'],
            ['💬 Задать вопрос'],
            ['ℹ️ О клинике'],
            ['👤 Мой профиль']
          ]).resize()
        );
      } catch (error) {
        console.error('Ошибка в команде /menu:', error);
      }
    });

    this.bot.hears('🏠 Главное меню', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        this.userStates.delete(userId);
        
        await ctx.reply(
          'Главное меню:\n\n' +
          'Я помогу вам:\n' +
          '• 📅 Записаться на процедуру\n' +
          '• 💬 Получить консультацию\n' +
          '• ℹ️ Узнать информацию о услугах\n' +
          '• 👤 Управление профилем\n\n' +
          'Выберите действие:',
          Markup.keyboard([
            ['📅 Записаться', '🏠 Главное меню'],
            ['💬 Задать вопрос'],
            ['ℹ️ О клинике'],
            ['👤 Мой профиль']
                   ]).resize()
        );
      } catch (error) {
        console.error('Ошибка в главном меню:', error);
      }
    });

    this.bot.hears('ℹ️ О клинике', async (ctx) => {
      try {
        await ctx.reply(
          'ℹ️ О нашей клинике:\n\n' +
          '🦷 Современное оборудование и опытные врачи\n' +
          '😁 Лечение, чистка, отбеливание, имплантация\n' +
          '🕘 Ежедневно с 09:00 до 20:00\n\n' +
          'Запишитесь через кнопку "📅 Записаться"!'
        );
      } catch (error) {
        console.error('Ошибка в информации о клинике:', error);
      }
    });

    this.bot.hears('👤 Мой профиль', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

        await this.showProfile(ctx);
      } catch (error) {
        console.error('Ошибка в команде профиля:', error);
        await ctx.reply('Произошла ошибка при загрузке профиля.');
      }
    });

    this.bot.hears('💬 Задать вопрос', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

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
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

        await this.showProfile(ctx);
      } catch (error) {
        console.error('Ошибка команды /myprofile:', error);
        await ctx.reply('Произошла ошибка при загрузке профиля.');
      }
    });

    this.bot.command('addfamily', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

        await this.startAddFamilyMember(ctx);
      } catch (error) {
        console.error('Ошибка команды /addfamily:', error);
        await ctx.reply('Произошла ошибка при добавлении члена семьи.');
      }
    });

    this.bot.command('myhistory', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

        await this.showVisitHistory(ctx);
      } catch (error) {
        console.error('Ошибка команды /myhistory:', error);
        await ctx.reply('Произошла ошибка при загрузке истории.');
      }
    });

    this.bot.command('changename', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

        await this.startChangeName(ctx);
      } catch (error) {
        console.error('Ошибка команды /changename:', error);
        await ctx.reply('Произошла ошибка при изменении имени.');
      }
    });

    this.bot.command('changephone', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

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
      state: 'adding_family_relation'
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
      state: 'changing_name'
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
      state: 'changing_phone'
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
        'Сначала создайте профиль, нажамите "📅 Записаться".',
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

      const doctors = require('../config/doctors.json');
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
        const userId = ctx.chat.id.toString();
        if (this.userStates.has(userId)) return;

        await this.startBooking(ctx);
      } catch (error) {
        console.error('Ошибка начала записи:', error);
        await ctx.reply('Произошла ошибка при начале записи.');
      }
    });

    this.bot.action('record_self', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_person') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const patient = userState.patientData;
        
        this.userStates.set(userId, {
          state: 'qualification',
          name: patient.name,
          phone: patient.phone,
          patientId: userId,
          patientData: patient
        });

        await ctx.editMessageText(
          'Скажите, вы уже проходили лечение в нашей клинике?',
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Да, постоянный пациент', 'qual_returning')],
            [Markup.button.callback('❌ Нет, впервые', 'qual_new')]
          ])
        );
      } catch (error) {
        console.error('Ошибка выбора себя:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('record_other', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_person') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'awaiting_name_other',
          forOther: true
        });

        await ctx.editMessageText('👤 Введите имя другого человека для записи:');
      } catch (error) {
        console.error('Ошибка выбора другого человека:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('record_as_new', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_person') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          state: 'awaiting_name'
        });

        await ctx.editMessageText('👤 Введите ваше имя:');
      } catch (error) {
        console.error('Ошибка записи как нового:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('qual_returning', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'qualification') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'returning_choice',
          isReturningPatient: true
        });

        await ctx.editMessageText(
          '🤖 Что у вас сейчас?',
          Markup.inlineKeyboard([
            [Markup.button.callback('🚨 Острая боль / срочно', 'problem_urgent')],
            [Markup.button.callback('🦷 Плановая коррекция', 'problem_routine')],
            [Markup.button.callback('🔍 Новая проблема', 'problem_new')]
          ])
        );
      } catch (error) {
        console.error('Ошибка выбора постоянного пациента:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('qual_new', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'qualification') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_procedure',
          mode: 'first'
        });

        await this.showProcedureSelection(ctx, 'first');
      } catch (error) {
        console.error('Ошибка выбора нового пациента:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_urgent', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'returning_choice') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_procedure',
          mode: 'urgent'
        });

        const urgentProcedures = [
          { id: 'acute_pain', name: 'Острая зубная боль', price: 'от 2500₽' },
          { id: 'broken', name: 'Сломался протез/брекет', price: 'от 3000₽' },
          { id: 'bleeding', name: 'Кровотечение', price: 'от 2000₽' }
        ];

        await this.showProcedureSelection(ctx, 'urgent', urgentProcedures);
      } catch (error) {
        console.error('Ошибка выбора срочной проблемы:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_routine', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'returning_choice') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'describe_routine'
        });

        await ctx.editMessageText('Опишите кратко что корректируем:');
      } catch (error) {
        console.error('Ошибка выбора плановой коррекции:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('problem_new', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'returning_choice') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'describe_problem'
        });

        await ctx.editMessageText('Опишите вашу проблему:');
      } catch (error) {
        console.error('Ошибка выбора новой проблемы:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('back_to_qualification', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_procedure') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'qualification'
        });

        await ctx.editMessageText(
          'Скажите, вы уже проходили лечение в нашей клинике?',
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Да, постоянный пациент', 'qual_returning')],
            [Markup.button.callback('❌ Нет, впервые', 'qual_new')]
          ])
        );
      } catch (error) {
        console.error('Ошибка возврата к квалификации:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/proc_(.+)/, async (ctx) => {
      try {
        const procedureId = ctx.match[1];
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_procedure') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        let procedureData;
        if (userState.mode === 'urgent') {
          const urgentProcedures = [
            { id: 'acute_pain', name: 'Острая зубная боль', price: 'от 2500₽' },
            { id: 'broken', name: 'Сломался протез/брекет', price: 'от 3000₽' },
            { id: 'bleeding', name: 'Кровотечение', price: 'от 2000₽' }
          ];
          procedureData = urgentProcedures.find(p => p.id === procedureId);
        } else {
          const procedures = aiService.getProcedures();
          procedureData = procedures.find(p => p.id === procedureId);
        }

        if (!procedureData) {
          await ctx.answerCbQuery('Процедура не найдена');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_doctor',
          procedure: procedureData
        });

        await this.showDoctorSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора процедуры:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/doctor_(.+)/, async (ctx) => {
      try {
        const doctorId = ctx.match[1];
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_doctor') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_date',
          doctorId: doctorId
        });

        await ctx.editMessageText('Выберите дату:');
        await this.showDateSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора врача:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action('back_to_doctor', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || !['choosing_date', 'choosing_daypart'].includes(userState.state)) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_doctor'
        });

        await this.showDoctorSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка возврата к врачу:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/date_(.+)/, async (ctx) => {
      try {
        const dateStr = ctx.match[1];
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_date') {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const selectedDate = new Date(dateStr);
        
        await ctx.editMessageText(
          `🔍 Ищу свободные окна на ${selectedDate.toLocaleDateString('ru-RU')}...`
        );

        const doctorId = userState.doctorId || 'any';
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
            
            this.userStates.set(userId, {
              ...userState,
              availableDays: nextAvailable
            });
          } else {
            await ctx.editMessageText(
              `На ${selectedDate.toLocaleDateString('ru-RU')} нет свободных окон.\n\n` +
              `Пожалуйста, выберите другую дату:`,
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

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_daypart',
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

    this.bot.action('choose_date', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_date'
        });

        await this.showDateSelection(ctx, userState);
      } catch (error) {
        console.error('Ошибка выбора другой даты:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/timepart_(.+)_(.+)/, async (ctx) => {
      try {
        const [_, dateStr, timePart] = ctx.match;
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || userState.state !== 'choosing_daypart') {
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

        this.userStates.set(userId, {
          ...userState,
          state: 'choosing_slot'
        });
      } catch (error) {
        console.error('Ошибка выбора части дня:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    this.bot.action(/time_(.+)_(.+)/, async (ctx) => {
      try {
        const [_, dateStr, timeStr] = ctx.match;
        const userId = ctx.chat.id.toString();
        const userState = this.userStates.get(userId);
        
        if (!userState || !['choosing_slot', 'choosing_daypart'].includes(userState.state)) {
          await ctx.answerCbQuery('Сессия устарела');
          return;
        }

        const slot = userState.availableSlots.find(s => s.formatted === timeStr);
        
        await ctx.editMessageText('📅 Создаю запись в календаре...');

        const bookingResult = await calendarService.createBooking(
          dateStr,
          timeStr,
          {
            name: userState.name,
            phone: userState.phone,
            priority: userState.mode === 'urgent' ? 'urgent' : 'normal',
            problemDescription: userState.problemDescription || '',
            isReturningPatient: userState.isReturningPatient || false
          },
          userState.procedure?.id || 'consultation',
          userState.doctorId === 'any' ? (slot?.freeDoctors?.[0] || null) : userState.doctorId
        );

        if (bookingResult.success) {
          if (userState.patientId) {
            await patientsService.updatePatient(userState.patientId, {
              lastMode: userState.mode,
              lastProcedure: userState.procedure?.name || 'consultation'
            });
            
            await patientsService.incrementVisitsCount(userState.patientId, {
              procedure: userState.procedure?.name || 'consultation',
              notes: userState.problemDescription || ''
            });
          } else {
            await patientsService.savePatient(userId, {
              name: userState.name,
              phone: userState.phone,
              lastMode: userState.mode,
              medicalHistory: {
                isReturningPatient: userState.isReturningPatient || false,
                lastProcedure: userState.procedure?.name || 'consultation'
              }
            });
          }

          const doctors = require('../config/doctors.json');
          const doctorId = userState.doctorId === 'any' ? (slot?.freeDoctors?.[0] || null) : userState.doctorId;
          const doctor = doctorId ? doctors.doctors.find(d => d.id === doctorId) : null;

          let adminPrefix = '';
          if (userState.mode === 'urgent') {
            adminPrefix = '🚨 СРОЧНО — ';
          } else if (userState.mode === 'routine') {
            adminPrefix = '🦷 Плановая коррекция — ';
          } else {
            adminPrefix = '🆕 Новая запись — ';
          }

          await ctx.editMessageText(
            `✅ Запись успешно создана!\n\n` +
            `Ваша запись подтверждена на:\n` +
            `📅 ${new Date(dateStr).toLocaleDateString('ru-RU')} в ${timeStr}\n` +
            `👨‍⚕️ ${doctor ? doctor.name : 'Любой свободный врач'}\n` +
            `👤 ${userState.name}\n` +
            (userState.procedure ? `🦷 ${userState.procedure.name}\n` : '') +
            `Мы ждём вас в клинике!`
          );

          if (process.env.ADMIN_CHAT_ID) {
            try {
              await this.bot.telegram.sendMessage(
                process.env.ADMIN_CHAT_ID,
                `${adminPrefix}\n\n` +
                `👤 ${userState.name} (${userState.phone})\n` +
                `📅 ${new Date(dateStr).toLocaleDateString('ru-RU')} в ${timeStr}\n` +
                (doctor ? `👨‍⚕️ ${doctor.name}\n` : '') +
                (userState.procedure ? `🦷 ${userState.procedure.name}\n` : '') +
                (userState.problemDescription ? `💬 ${userState.problemDescription.substring(0, 200)}\n` : '')
              );
            } catch (error) {
              console.error('Ошибка уведомления админа:', error);
            }
          }

          this.userStates.delete(userId);
        } else if (bookingResult.error === 'slot_busy') {
          await ctx.editMessageText(
            '😔 Извините, это время только что заняли. Вот другие свободные окна:',
            Markup.inlineKeyboard(
              userState.availableSlots
                .filter(s => s.formatted !== timeStr)
                .slice(0, 5)
                .map(slot => [
                  Markup.button.callback(
                    `${slot.formatted}`,
                    `time_${dateStr}_${slot.formatted}`
                  )
                ])
            )
          );
        } else {
          throw new Error('Не удалось создать запись');
        }
      } catch (error) {
        console.error('Ошибка выбора времени:', error);
        await ctx.editMessageText(
          '😔 Не удалось создать запись. Пожалуйста, попробуйте позже.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Попробовать снова', 'retry_booking')]
          ])
        );
      }
    });

    this.bot.action('retry_booking', async (ctx) => {
      try {
        const userId = ctx.chat.id.toString();
        this.userStates.delete(userId);
        await ctx.deleteMessage();
        await ctx.reply(
          'Давайте попробуем снова!',
          Markup.keyboard([['📅 Записаться'], ['💬 Задать вопрос']]).resize()
        );
      } catch (error) {
        console.error('Ошибка повторной попытки:', error);
      }
    });
  }

  async startBooking(ctx) {
    try {
      const userId = ctx.from.id.toString();
      
      if (this.userStates.has(userId)) {
        return;
      }

      const patient = patientsService.getPatient(userId);
      
      if (patient) {
        this.userStates.set(userId, { 
          state: 'choosing_person',
          patientData: patient 
        });
        
        await ctx.reply(
          `Здравствуйте, ${patient.name}! 👋\nКого запишем?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('👤 Себя', 'record_self')],
            [Markup.button.callback('👨‍👩‍👧 Другого человека', 'record_other')],
            [Markup.button.callback('🔍 Записаться как новый', 'record_as_new')]
          ])
        );
      } else {
        this.userStates.set(userId, { state: 'awaiting_name' });
        await ctx.reply('👤 Введите ваше имя:');
      }
    } catch (error) {
      console.error('Ошибка старта записи:', error);
      await ctx.reply('Произошла ошибка при начале записи.');
    }
  }

  async handleAwaitingName(ctx, text, userState) {
    try {
      const userId = ctx.chat.id.toString();
      
      if (text.length < 2 || /^\d+$/.test(text)) {
        await ctx.reply('Пожалуйста, введите имя (минимум 2 символа, не только цифры):');
        return;
      }

      const name = text.trim();
      
      this.userStates.set(userId, {
        ...userState,
        state: 'awaiting_phone',
        name: name
      });

      await ctx.reply(`Отлично, ${name}! Введите телефон:`);
    } catch (error) {
      console.error('Ошибка обработки имени:', error);
      await ctx.reply('Произошла ошибка при обработки имени.');
    }
  }

  async handleAwaitingNameOther(ctx, text, userState) {
    try {
      const userId = ctx.chat.id.toString();
      
      if (text.length < 2 || /^\d+$/.test(text)) {
        await ctx.reply('Пожалуйста, введите имя (минимум 2 символа, не только цифры):');
        return;
      }

      const name = text.trim();
      
      this.userStates.set(userId, {
        ...userState,
        state: 'awaiting_phone',
        name: name,
        forOther: true
      });

      await ctx.reply(`Отлично! Введите телефон ${name}:`);
    } catch (error) {
      console.error('Ошибка обработки имени другого:', error);
      await ctx.reply('Произошла ошибка при обработки имени.');
    }
  }

  async handleAwaitingPhone(ctx, text, userState) {
    try {
      const userId = ctx.chat.id.toString();
      const phoneRegex = /^(\+7|8)\d{10}$/;
      
      const cleanPhone = text.replace(/\s|\(|\)|-/g, '');
      
      if (!phoneRegex.test(cleanPhone)) {
        await ctx.reply('Пожалуйста, введите номер в правильном формате (+7XXXXXXXXXX или 8XXXXXXXXXX):');
        return;
      }

      const formattedPhone = cleanPhone.startsWith('8') ? '+7' + cleanPhone.slice(1) : cleanPhone;
      
      this.userStates.set(userId, {
        ...userState,
        state: 'qualification',
        phone: formattedPhone
      });

      await ctx.reply(
        'Скажите, вы уже проходили лечение в нашей клинике?',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, постоянный пациент', 'qual_returning')],
          [Markup.button.callback('❌ Нет, впервые', 'qual_new')]
        ])
      );
    } catch (error) {
      console.error('Ошибка обработки телефона:', error);
      await ctx.reply('Произошла ошибка при обработки телефона.');
    }
  }

  async handleDescribeRoutine(ctx, text, userState) {
    try {
      const userId = ctx.chat.id.toString();
      
      this.userStates.set(userId, {
        ...userState,
        state: 'choosing_procedure',
        mode: 'routine',
        problemDescription: text.trim()
      });

      await this.showProcedureSelection(ctx, 'routine');
    } catch (error) {
      console.error('Ошибка обработки описания рутины:', error);
      await ctx.reply('Произошла ошибка при обработки описания.');
    }
  }

  async handleDescribeProblem(ctx, text, userState) {
    try {
      const userId = ctx.chat.id.toString();
      
      this.userStates.set(userId, {
        ...userState,
        state: 'choosing_procedure',
        mode: 'new',
        problemDescription: text.trim()
      });

      await this.showProcedureSelection(ctx, 'new');
    } catch (error) {
      console.error('Ошибка обработки описания проблемы:', error);
      await ctx.reply('Произошла ошибка при обработки описания.');
    }
  }

  async showProcedureSelection(ctx, mode, proceduresList = null) {
    try {
      const userId = ctx.chat.id.toString();
      const userState = this.userStates.get(userId);
      
      if (!userState) {
        return;
      }

      let procs = proceduresList;
      if (!procs) {
        const allProcedures = aiService.getProcedures();
        procs = allProcedures.map(p => ({
          id: p.id,
          name: p.название,
          price: p.цена
        }));
      }

      const buttons = procs.map(p => [
        Markup.button.callback(
          `${p.name} — ${p.price}`, 
          `proc_${p.id}`
        )
      ]);

      buttons.push([Markup.button.callback('↩️ Назад', 'back_to_qualification')]);

      await ctx.reply(
        'Выберите процедуру:',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      console.error('Ошибка показа процедур:', error);
      await ctx.reply('Произошла ошибка при загрузке процедур.');
    }
  }

  async showDoctorSelection(ctx, userState) {
    try {
      const doctors = require('../config/doctors.json');
      
      if (doctors.doctors.length === 1) {
        const singleDoctor = doctors.doctors[0];
        const userId = ctx.chat.id.toString();
        
        this.userStates.set(userId, {
          ...this.userStates.get(userId),
          state: 'choosing_date',
          doctorId: singleDoctor.id
        });

        await ctx.reply(
          `Записываем к ${singleDoctor.name} (${singleDoctor.specialty}).\n\n` +
          'Выберите дату:',
          Markup.inlineKeyboard([
            [Markup.button.callback('📅 Выбрать дату', 'choose_date')]
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
      buttons.push([Markup.button.callback('↩️ Назад к процедурам', 'back_to_procedure')]);

      await ctx.reply(
        '🤔 К какому врачу запишем?',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      console.error('Ошибка показа выбора врача:', error);
      await ctx.reply('Произошла ошибка при загрузке врачей.');
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

      await ctx.reply(
        '📅 Выберите дату:',
        Markup.inlineKeyboard(buttons)
      );
    } catch (error) {
      console.error('Ошибка показа выбора даты:', error);
      await ctx.reply('Произошла ошибка при загрузке дат.');
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
          'awaiting_name', 'awaiting_name_other', 'awaiting_phone',
          'describe_routine', 'describe_problem'
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