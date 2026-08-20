const fs = require('fs').promises;
const path = require('path');

class PatientsService {
  constructor() {
    this.patients = {};
    this.dataPath = path.join(__dirname, '../../data/patients.json');
    this.initialized = false;
  }

  async initialize() {
    try {
      await this.ensureDataDirectory();
      await this.loadPatients();
      console.log('📁 CRM система загружена:', Object.keys(this.patients).length, 'пациентов');
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('❌ Ошибка инициализации CRM:', error.message);
      this.initialized = false;
      return false;
    }
  }

  async ensureDataDirectory() {
    const dataDir = path.join(__dirname, '../../data');
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }
  }

  async loadPatients() {
    try {
      const data = await fs.readFile(this.dataPath, 'utf8');
      this.patients = JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.patients = {};
        await this.savePatients();
      } else {
        throw error;
      }
    }
  }

  async savePatients() {
    try {
      await fs.writeFile(this.dataPath, JSON.stringify(this.patients, null, 2), 'utf8');
    } catch (error) {
      console.error('Ошибка сохранения пациентов:', error);
      throw error;
    }
  }

  getPatient(userId) {
    return this.patients[userId] || null;
  }

  async savePatient(userId, data) {
    this.patients[userId] = {
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      visitsCount: data.visitsCount || 0,
      lastVisit: data.lastVisit || null,
      medicalHistory: data.medicalHistory || {
        isReturningPatient: false,
        lastProcedure: '',
        notes: ''
      },
      familyMembers: data.familyMembers || []
    };
    
    await this.savePatients();
    return this.patients[userId];
  }

  async updatePatient(userId, updates) {
    if (!this.patients[userId]) {
      throw new Error('Пациент не найден');
    }

    this.patients[userId] = {
      ...this.patients[userId],
      ...updates,
      medicalHistory: {
        ...this.patients[userId].medicalHistory,
        ...(updates.medicalHistory || {})
      },
      familyMembers: updates.familyMembers !== undefined 
        ? updates.familyMembers 
        : this.patients[userId].familyMembers
    };

    await this.savePatients();
    return this.patients[userId];
  }

  async incrementVisitsCount(userId, visitData = {}) {
    const patient = this.getPatient(userId);
    if (!patient) return null;

    const updated = await this.updatePatient(userId, {
      visitsCount: patient.visitsCount + 1,
      lastVisit: new Date().toISOString(),
      ...(visitData.procedure && {
        medicalHistory: {
          lastProcedure: visitData.procedure,
          notes: visitData.notes || patient.medicalHistory.notes
        }
      })
    });

    return updated;
  }

  async addFamilyMember(userId, member) {
    const patient = this.getPatient(userId);
    if (!patient) return null;

    if (!patient.familyMembers) {
      patient.familyMembers = [];
    }

    const newMember = {
      relation: member.relation,
      name: member.name,
      phone: member.phone,
      addedAt: new Date().toISOString()
    };

    patient.familyMembers.push(newMember);

    await this.updatePatient(userId, {
      familyMembers: patient.familyMembers
    });

    return newMember;
  }

  async removeFamilyMember(userId, memberIndex) {
    const patient = this.getPatient(userId);
    if (!patient || !patient.familyMembers || patient.familyMembers.length <= memberIndex) {
      return false;
    }

    patient.familyMembers.splice(memberIndex, 1);
    await this.updatePatient(userId, {
      familyMembers: patient.familyMembers
    });

    return true;
  }

  async updateMedicalHistory(userId, updates) {
    const patient = this.getPatient(userId);
    if (!patient) return null;

    return await this.updatePatient(userId, {
      medicalHistory: {
        ...patient.medicalHistory,
        ...updates
      }
    });
  }

  async searchByPhone(phone) {
    const normalizedPhone = this.normalizePhone(phone);
    
    for (const [userId, patient] of Object.entries(this.patients)) {
      if (this.normalizePhone(patient.phone) === normalizedPhone) {
        return { userId, patient };
      }

      if (patient.familyMembers) {
        for (const member of patient.familyMembers) {
          if (this.normalizePhone(member.phone) === normalizedPhone) {
            return { userId, patient, familyMember: member };
          }
        }
      }
    }

    return null;
  }

  normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').replace(/^8/, '7').replace(/^\+?/, '');
  }

  async getAllPatients() {
    return { ...this.patients };
  }

  async getPatientStats() {
    const total = Object.keys(this.patients).length;
    const returning = Object.values(this.patients).filter(p => 
      p.visitsCount > 1
    ).length;
    
    return {
      total,
      returning,
      new: total - returning,
      averageVisits: total > 0 
        ? Object.values(this.patients).reduce((sum, p) => sum + p.visitsCount, 0) / total 
        : 0
    };
  }
}

module.exports = new PatientsService();