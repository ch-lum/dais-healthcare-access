import type { Application } from 'express';

interface AppKitWithServer {
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const pipelineBlueprint = {
  name: 'facility-prioritization',
  summary:
    'Pre-template healthcare access pipeline for cleaning facility data, modeling treatment demand, and producing district-level priority scores.',
  pythonRoot: 'python/src/facility_prioritization',
  configPath: 'python/config/config.yaml',
  requirementsPath: 'python/requirements.txt',
  stages: [
    {
      id: 'facility-processing',
      title: 'Facility Processing',
      file: 'python/src/facility_prioritization/facility_processing.py',
      functions: ['clean_facility_data', 'extract_top_treatments', 'create_supply_table'],
      description:
        'Cleans the raw facilities dataset, extracts high-signal treatments, and builds the supply-side table.',
    },
    {
      id: 'survey-processing',
      title: 'Survey Processing',
      file: 'python/src/facility_prioritization/survey_processing.py',
      functions: ['clean_survey_data'],
      description:
        'Standardizes the survey inputs and preserves district/state identifiers for downstream scoring.',
    },
    {
      id: 'demand-modeling',
      title: 'Demand Modeling',
      file: 'python/src/facility_prioritization/demand_modeling.py',
      functions: ['generate_symptom_mapping', 'calculate_treatment_scores', 'create_demand_table'],
      description:
        'Maps treatments to survey signals, converts survey indicators into treatment demand scores, and builds the demand table.',
    },
    {
      id: 'priority-scoring',
      title: 'Priority Scoring',
      file: 'python/src/facility_prioritization/priority_scoring.py',
      functions: ['create_priority_table'],
      description:
        'Combines demand, supply, and geography to produce distance-decayed priority scores by district and treatment.',
    },
    {
      id: 'shared-utils',
      title: 'Shared Utilities',
      file: 'python/src/facility_prioritization/utils.py',
      functions: ['haversine_distance', 'piecewise_distance_decay', 'match_district_names'],
      description:
        'Provides reusable geographic distance and matching helpers for the prioritization pipeline.',
    },
  ],
  databricksTables: [
    'facility_table',
    'survey_table',
    'geo_reference_table',
  ],
  configPreview: {
    topNTreatments: 5,
    openAiModel: 'gpt-4o-mini',
    distanceDecay: 'piecewise',
    outputFile: 'priority_table.csv',
  },
};

export function setupPrioritizationRoutes(appkit: AppKitWithServer) {
  appkit.server.extend((app) => {
    app.get('/api/prioritization/blueprint', (_req, res) => {
      res.json(pipelineBlueprint);
    });
  });
}
