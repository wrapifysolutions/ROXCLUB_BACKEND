const engineConfig = require('../../config/arena-engine.json');

function simulationEngine(inputs = {}) {
    return {
        available: false,
        reason: engineConfig.reason,
        message: engineConfig.message,
        inputs: {
            athleteDna: inputs.athleteDna == null ? 'missing' : 'present',
            stationProficiency: Array.isArray(inputs.stationProficiency) ? 'present' : 'missing',
            currentReadiness: inputs.readiness == null ? 'missing' : 'present',
            recentEvidenceConfidence: inputs.recentEvidenceConfidence || 'missing',
            pacingStrategy: inputs.pacingStrategy || 'target',
            fatigueModel: inputs.fatigueModel?.available ? 'present' : 'not_implemented',
        },
        predictionAvailable: false,
        predictedFinishMs: null,
        checkpointAdvice: null,
    };
}

module.exports = { simulationEngine, engineConfig };
