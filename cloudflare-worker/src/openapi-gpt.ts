export const CFI_GPT_OPENAPI = `openapi: 3.1.0
info:
  title: CFI Football Intelligence Production API
  version: 5.2.5-gpt-v2
servers:
  - url: https://cfi-football-intelligence.baoanhrat112020.workers.dev
paths:
  /api/status:
    get:
      operationId: cfiGetStatus
      summary: Get CFI runtime and Persistent DB health
      responses:
        '200': {description: Runtime status}
  /api/discover:
    post:
      operationId: cfiDiscoverMatches
      summary: Discover validate predict and rank current CFI opportunities
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [target_date]
              properties:
                target_date: {type: string, format: date}
                timezone: {type: string, default: Asia/Ho_Chi_Minh}
                start_time: {type: string}
                end_time: {type: string}
                max_matches: {type: integer, minimum: 1, maximum: 10, default: 5}
                scan_limit: {type: integer, minimum: 1, maximum: 200, default: 80}
                internal_provider_diagnostics: {type: boolean, default: false}
                fixture_candidates:
                  type: array
                  maxItems: 200
                  items:
                    type: object
                    required: [providerId, home, away, kickoffIso, sourceUrls, discoveredAt]
                    properties:
                      provider: {type: string, default: GPT_WEB_SEARCH}
                      providerId: {type: string}
                      home: {type: string}
                      away: {type: string}
                      competition: {type: string}
                      country: {type: string}
                      kickoffIso: {type: string, format: date-time}
                      targetDate: {type: string, format: date}
                      status: {type: string, default: scheduled}
                      sourceUrls: {type: array, minItems: 1, items: {type: string, format: uri}}
                      discoveredAt: {type: string, format: date-time}
                    additionalProperties: false
                odds_by_fixture: {type: object, additionalProperties: true}
              additionalProperties: false
      responses:
        '200': {description: CFI Daily Opportunity Board}
  /api/predict:
    post:
      operationId: cfiPredictMatch
      summary: Run complete CFI strict-prior prematch prediction
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [home, away]
              properties:
                home: {type: string}
                away: {type: string}
                target_date: {type: string, format: date}
                language: {type: string, enum: [vi, en, zh, th, id], default: vi}
              additionalProperties: false
      responses:
        '200': {description: CFI six-target prediction}
  /api/predict-live:
    post:
      operationId: cfiPredictLive
      summary: Run CFI LIVE prediction with frozen strict-prior prematch evidence
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [home, away]
              properties:
                home: {type: string}
                away: {type: string}
                target_date: {type: string, format: date}
                language: {type: string, default: vi}
                matchStatus: {type: string}
                fixtureStatus: {type: string}
                status: {type: string}
                live: {type: object, additionalProperties: true}
              additionalProperties: true
      responses:
        '200': {description: CFI LIVE prediction}
  /api/prediction-history:
    get:
      operationId: cfiGetPredictionHistory
      summary: Get immutable prediction history
      parameters:
        - {name: limit, in: query, schema: {type: integer, minimum: 1, maximum: 100, default: 20}}
        - {name: target_date, in: query, schema: {type: string, format: date}}
        - {name: home, in: query, schema: {type: string}}
        - {name: away, in: query, schema: {type: string}}
      responses:
        '200': {description: Prediction history}
  /api/results:
    get:
      operationId: cfiGetResults
      summary: Get prediction versus actual settlement results
      responses:
        '200': {description: Settlement results}
  /api/collect-results:
    post:
      operationId: cfiCollectResults
      summary: Collect actual results and settle immutable predictions
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                snapshot_id: {type: string}
                target_date: {type: string, format: date}
                home: {type: string}
                away: {type: string}
                limit: {type: integer, minimum: 1, maximum: 100, default: 20}
              additionalProperties: false
      responses:
        '200': {description: Collector summary}
`;
