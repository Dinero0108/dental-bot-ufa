# Настройка Google Calendar API для бота

## 1. Создание проекта в Google Cloud Console

1. Перейдите на [Google Cloud Console](https://console.cloud.google.com/)
2. Нажмите "Select a project" → "NEW PROJECT"
3. Введите название проекта (например, "Telegram Dentist Bot")
4. Нажмите "CREATE"

## 2. Включение Google Calendar API

1. В меню слева выберите "APIs & Services" → "Library"
2. Найдите "Google Calendar API"
3. Нажмите на результат поиска
4. Нажмите "ENABLE"

## 3. Создание Service Account

1. В меню слева выберите "APIs & Services" → "Credentials"
2. Нажмите "CREATE CREDENTIALS" → "Service Account"
3. Заполните данные:
   - Service account name: `telegram-dentist-bot`
   - Service account ID: будет сгенерирован автоматически
   - Description: "Service account for Telegram dentist bot"
4. Нажмите "CREATE AND CONTINUE"
5. Пропустите этап предоставления ролей (нажмите "CONTINUE")
6. Нажмите "DONE"

## 4. Создание ключа Service Account

1. В списке Service Accounts нажмите на только что созданный аккаунт
2. Перейдите на вкладку "KEYS"
3. Нажмите "ADD KEY" → "Create new key"
4. Выберите тип ключа: JSON
5. Нажмите "CREATE"
6. Файл ключа будет скачан автоматически

## 5. Подготовка JSON ключа для бота

1. Откройте скачанный JSON файл в текстовом редакторе
2. Скопируйте ВЕСЬ содержимый JSON
3. Закодируйте JSON в base64:
   - Можно использовать онлайн-инструмент: https://www.base64encode.org/
   - Или командой в терминале:
     ```bash
     cat service-account.json | base64
     ```
4. Сохраните полученную base64 строку

## 6. Настройка календаря

1. Откройте [Google Calendar](https://calendar.google.com/)
2. Создайте новый календарь для записей:
   - Слева нажмите "+" рядом с "Other calendars"
   - Выберите "Create new calendar"
   - Название: "Записи клиники"
   - Описание: "Записи пациентов через Telegram бота"
   - Часовой пояс: "Москва (GMT+3)"
3. Нажмите "Create calendar"

## 7. Предоставление доступа Service Account к календарю

1. В настройках созданного календаря найдите раздел "Share with specific people"
2. Нажмите "Add people"
3. Введите email вашего Service Account (можно найти в JSON файле в поле "client_email")
4. Выберите права доступа: "Make changes to events"
5. Нажмите "Send"

## 8. Получение Calendar ID

1. В настройках календаря найдите "Calendar ID"
2. Скопируйте значение (формат: `xxxxxx@group.calendar.google.com`)
3. Сохраните его для использования в `.env` файле

## 9. Настройка переменных окружения

В файле `.env` укажите:

```
GOOGLE_CALENDAR_ID=ваш_calendar_id@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_JSON=ваша_base64_строка_с_JSON_ключа
```

## 10. Проверка доступа

Запустите бота:
```bash
npm start
```

Если всё настроено правильно, вы увидите в консоли:
```
✅ Google Calendar API успешно подключен
```

## Важные примечания

1. **Безопасность**: Никогда не коммитьте JSON ключ в репозиторий
2. **Квота**: Google Calendar API имеет лимиты на количество запросов
3. **Тестирование**: Перед запуском в продакшн протестируйте в тестовом календаре
4. **Резервное копирование**: Регулярно экспортируйте данные календаря

## Решение проблем

### Ошибка авторизации
- Проверьте, что Service Account имеет доступ к календарю
- Убедитесь, что Calendar ID указан правильно
- Проверьте, что JSON ключ правильно закодирован в base64

### Ошибка доступа к API
- Убедитесь, что Google Calendar API включен в проекте
- Проверьте квоты API в Google Cloud Console

### События не создаются
- Проверьте права доступа Service Account к календарю (должны быть "Make changes to events")
- Убедитесь, что календарь существует и не архивирован