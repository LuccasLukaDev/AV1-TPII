import {
  Projeto,
  EquipeSugerida,
  Profissional,
  Recomendacao
} from '../domain/entities.js';

import { ProfessionalRepository } from '../repositories/professional.repository.js';
import { ProjectRepository } from '../repositories/project.repository.js';

import { CosineSimilarityStrategy } from '../strategies/cosine.strategy.js';
import { CollaborativeFilteringStrategy } from '../strategies/colaborative.strategy.js';
import { LowBudgetRulesStrategy } from '../strategies/low-budget.strategy.js';
import { RecommendationStrategy } from '../strategies/recommendation.strategy.js';

import { DefaultTeamCompositionOrchestrator } from '../template/team-composition.orchestrator.js';

import { NotificationSubject } from '../observers/notification.subject.js';
import { AuditObserver } from '../observers/audit.observer.js';

import { ConsistencyVisitor } from '../visitors/consistency.visitor.js';
import { CompatibilityVisitor } from '../visitors/compatibility.visitor.js';
import { ReportVisitor } from '../visitors/report.visitor.js';

export class RecommendationService {
  constructor(
    private readonly repo: ProfessionalRepository = new ProfessionalRepository(),
    private readonly projectRepository: ProjectRepository = new ProjectRepository(),
    private readonly subject: NotificationSubject = new NotificationSubject(),
    private readonly audit: AuditObserver = new AuditObserver()
  ) {
    // Não faz attach aqui.
    // Os observers já são anexados no controller.
  }

  async recommend(
    project: Projeto,
    excludedProfessionalIds: string[] = []
  ): Promise<{
    equipe: EquipeSugerida;
    consistency: any;
    compatibility: any;
    report: string;
  }> {
    const professionals = await this.getEligibleProfessionals(
      project,
      excludedProfessionalIds
    );

    if (professionals.length === 0) {
      throw new Error(
        'Nenhum profissional elegível foi encontrado para o projeto.'
      );
    }

    const strategy = this.createStrategy(project.estrategia);
    const orchestrator = new DefaultTeamCompositionOrchestrator(strategy);
    const equipe = orchestrator.compose(project, professionals);

    await this.projectRepository.saveRecommendationResult(project, equipe);

    this.subject.notify('recommendation_generated', {
      projetoId: project.id,
      equipe
    });

    const consistency = new ConsistencyVisitor();
    const compatibility = new CompatibilityVisitor();
    const report = new ReportVisitor();

    consistency.visitProject(project);
    compatibility.visitProject(project);
    report.visitProject(project);

    for (const rec of equipe.recomendacoes) {
      consistency.visitProfessional(rec.profissional, rec.papel);
      compatibility.visitProfessional(rec.profissional);
      report.visitProfessional(rec.profissional, rec.papel);
    }

    consistency.check(
      project,
      equipe.recomendacoes.map((r) => ({
        papel: r.papel,
        profissional: r.profissional
      }))
    );

    return {
      equipe,
      consistency: consistency.getResult(),
      compatibility: compatibility.getResult(),
      report: report.getResult()
    };
  }

  async recommendForRole(
    project: Projeto,
    papel: string,
    excludedProfessionalIds: string[] = []
  ): Promise<Recomendacao> {
    const normalizedRole = this.normalizeText(papel);

    const roleProject: Projeto = {
      ...project,
      papeis: project.papeis.filter(
        (item) => this.normalizeText(item.papel) === normalizedRole
      )
    };

    if (roleProject.papeis.length === 0) {
      throw new Error(`O papel "${papel}" não existe no projeto.`);
    }

    const professionals = await this.getEligibleProfessionals(
      roleProject,
      excludedProfessionalIds
    );

    if (professionals.length === 0) {
      throw new Error(
        `Nenhum profissional elegível foi encontrado para o papel "${papel}".`
      );
    }

    const strategy = this.createStrategy(roleProject.estrategia);
    const orchestrator = new DefaultTeamCompositionOrchestrator(strategy);
    const equipe = orchestrator.compose(roleProject, professionals);

    const recommendation = equipe.recomendacoes.find(
      (item) => this.normalizeText(item.papel) === normalizedRole
    );

    if (!recommendation) {
      throw new Error(
        `Não foi possível gerar uma nova recomendação para "${papel}".`
      );
    }

    await this.projectRepository.saveRecommendationForRole(
      project.id,
      normalizedRole,
      recommendation
    );

    this.subject.notify('recommendation_replaced', {
      projetoId: project.id,
      papel: normalizedRole,
      recomendacao: recommendation
    });

    return recommendation;
  }

  getAuditLogs() {
    return this.audit.getLogs();
  }

  getNotificationSubject() {
    return this.subject;
  }

  private createStrategy(
    estrategia: Projeto['estrategia']
  ): RecommendationStrategy {
    switch (estrategia) {
      case 'collaborative':
        return new CollaborativeFilteringStrategy();
      case 'low-budget':
        return new LowBudgetRulesStrategy();
      case 'cosine':
      default:
        return new CosineSimilarityStrategy();
    }
  }

  private async getEligibleProfessionals(
    project: Projeto,
    excludedProfessionalIds: string[]
  ): Promise<Profissional[]> {
    const professionals = await this.repo.findAll();
    const excluded = new Set(excludedProfessionalIds);
    const delivery = new Date(project.dataEntrega);

    const available = professionals.filter((professional) => {
      if (excluded.has(professional.id)) {
        return false;
      }

      if (professional.disponibilidade.length === 0) {
        return false;
      }

      return professional.disponibilidade.some((period) => {
        const inicio = new Date(period.inicio);
        const fim = new Date(period.fim);
        return inicio <= delivery && delivery <= fim;
      });
    });

    const projectLocation = this.normalizeText(project.localizacao);

    const sameLocation = available.filter(
      (professional) =>
        this.normalizeText(professional.localizacao) === projectLocation
    );

    const otherLocations = available.filter(
      (professional) =>
        this.normalizeText(professional.localizacao) !== projectLocation
    );

    return [...sameLocation, ...otherLocations];
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}