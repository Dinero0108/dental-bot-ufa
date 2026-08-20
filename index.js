require('dotenv').config();
const calendarService = require('./src/services/calendar');
const aiService = require('./src/services/ai');
const patientsService = require('./src/services/patients');
const bot = require('./src/bot');

async function main() {
  console.log('🚀 Запуск стоматологического бота...\n');

  try {
    console.log('1. Проверка Telegram...');
    await bot.initialize();
    console.log('✅ Telegram подключен');

    console.log('2. Проверка Google Calendar...');
    await calendarService.initialize();
    console.log('✅ Google Calendar подключен');

    console.log('3. Проверка AI...');
    await aiService.initialize();
    console.log('✅ AI подключен');

    console.log('4. Проверка CRM...');
    await patientsService.initialize();
    console.log('✅ CRM система подключена');

    console.log('5. Запуск бота...');
    await bot.start();

    console.log('\n✅ Бот успешно запущен!');
    
    if (process.env.ADMIN_CHAT_ID) {
      console.log(`👤 Администратор: ${process.env.ADMIN_CHAT_ID}`);
    }

  } catch (error) {
    console.error('\n❌ Ошибка запуска:', error.message);
    console.error('\n💡 Проверьте переменные окружения в .env:');
    console.error('   • BOT_TOKEN - токен Telegram бота');
    console.error('   • GOOGLE_SERVICE_ACCOUNT_JSON - base64 service account');
    console.error('   • GOOGLE_CALENDAR_ID - ID календаря');
    console.error('   • AI_API_KEY - ключ VSellm/OpenAI API');
    
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Необработанное исключение:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ Непойманное исключение:', error);
});

if (require.main === module) {
  main();
}

module.exports = { main };