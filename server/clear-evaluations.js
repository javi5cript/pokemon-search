const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearEvaluations() {
  try {
    console.log('🗑️  Clearing all evaluation data...');
    
    const result = await prisma.evaluation.deleteMany({});
    
    console.log(`✅ Successfully deleted ${result.count} evaluation records`);
    console.log('💡 All grading data has been cleared. Listings remain intact.');
    console.log('🔄 Refresh your browser to see the "Grade This Card" buttons again.');
    
  } catch (error) {
    console.error('❌ Error clearing evaluations:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearEvaluations();
