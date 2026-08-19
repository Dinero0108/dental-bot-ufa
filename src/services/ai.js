const fs = require('fs').promises;
const path = require('path');

class AIService {
  constructor() {
    this.apiKey = process.env.AI_API_KEY;
    this.baseUrl = process.env.AI_BASE_URL || 'https://api.vsellm.com/v1';
    this.model = process.env.AI_MODEL || 'vsellm';
    this.systemPrompt = '';
    this.procedures = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      if (!this.apiKey) {
        throw new Error('AI_API_KEY не указан в .env');
      }

      this.systemPrompt = await fs.readFile(
        path.join(__dirname, '../../prompts/system.txt'), 
        'utf8'
      );

      this.procedures = require('../../config/procedures.json');
      console.log('📋 Загружено процедур:', this.procedures.процедуры?.length || 0);

      const priceList = this.procedures.процедуры
        .map(p => `- ${p.название} — ${p.цена}`)
        .join('\n');

      this.systemPrompt = this.systemPrompt.replace('ПРАЙС:', `ПРАЙС:\n${priceList}`);

      console.log('✅ AI подключен');
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ AI:', error.message);
      throw new Error(`AI: ${error.message}. Проверьте AI_API_KEY в .env`);
    }
  }

  async generateResponse(userMessage) {
    if (!this.initialized || !this.apiKey) {
      throw new Error('AI сервис не инициализирован');
    }

    try {
      const fetch = require('node-fetch');
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: this.systemPrompt
            },
            {
              role: 'user',
              content: userMessage
            }
          ],
          max_tokens: 1000,
          temperature: 0.7,
        }),
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`AI API ошибка: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.choices[0]?.message?.content || 
        'Извините, не удалось получить ответ. Хотите записаться на консультацию?';

      return this.formatResponse(aiResponse);
    } catch (error) {
      console.error('Ошибка AI:', error.message);
      throw error;
    }
  }

  formatResponse(response) {
    const maxLength = 4096;
    
    if (response.length <= maxLength) {
      return response + '\n\n🤔 Хотите записаться на удобное время?';
    }

    const sentences = response.split(/[.!?]+/);
    let chunk = '';
    const chunks = [];

    for (const sentence of sentences) {
      if ((chunk + sentence).length <= maxLength - 100) {
        chunk += sentence + '. ';
      } else {
        if (chunk) chunks.push(chunk.trim());
        chunk = sentence + '. ';
      }
    }
    
    if (chunk) chunks.push(chunk.trim());

    const result = chunks[0] + '\n\n🤔 Хотите записаться на удобное время?';
    
    if (chunks.length > 1) {
      return result + '\n\n(Продолжение в следующем сообщении...)';
    }
    
    return result;
  }

  getProcedures() {
    return this.procedures ? this.procedures.процедуры : [];
  }

  getProcedureById(id) {
    if (!this.procedures) return null;
    return this.procedures.процедуры.find(p => p.id === id);
  }
}

module.exports = new AIService();