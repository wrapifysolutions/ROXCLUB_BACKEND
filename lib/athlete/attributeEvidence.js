const MAPPING_REASON = 'DNA_ATTRIBUTE_MAPPING_NOT_APPROVED';

const ATTRIBUTE_EVIDENCE = [
    {
        key: 'endurance',
        mappingStatus: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        documentation: 'Product Master V2 §8–9; Revision 1 §8. No approved impact rule.',
        preservedMetrics: ['distanceM', 'durationSec', 'paceSecPerKm', 'avgHr'],
    },
    {
        key: 'engine',
        mappingStatus: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        documentation: 'Product Master V2 §8–9; Revision 1 §8. No approved impact rule.',
        preservedMetrics: ['durationSec', 'distanceM', 'avgHr', 'reps', 'loadKg'],
    },
    {
        key: 'strength',
        mappingStatus: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        documentation: 'Product Master V2 §8 requires bodyweight normalization. The formula is TBD in §30.',
        preservedMetrics: ['loadKg', 'reps', 'sets', 'durationSec'],
        availableInputs: ['bodyweightKg'],
    },
    {
        key: 'power',
        mappingStatus: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        documentation: 'Product Master V2 §8–9; Revision 1 §8. No approved impact rule.',
        preservedMetrics: ['loadKg', 'reps', 'durationSec', 'distanceM'],
    },
    {
        key: 'speed',
        mappingStatus: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        documentation: 'Product Master V2 §8–9. Speed is not Mobility. No approved speed formula.',
        preservedMetrics: ['distanceM', 'durationSec', 'paceSecPerKm'],
    },
];

function attributeEvidenceCatalog() {
    return {
        status: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        attributes: ATTRIBUTE_EVIDENCE.map((row) => ({ ...row, preservedMetrics: [...row.preservedMetrics] })),
    };
}

function pendingAttributeMapping() {
    return {
        status: 'PENDING_APPROVAL',
        reason: MAPPING_REASON,
        attributes: null,
    };
}

module.exports = {
    MAPPING_REASON,
    ATTRIBUTE_EVIDENCE,
    attributeEvidenceCatalog,
    pendingAttributeMapping,
};
