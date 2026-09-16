import {
  Projeto,
  Profissional,
  Recomendacao,
  EquipeSugerida
} from '../domain/entities.js';

import { RecommendationStrategy } from '../strategies/recommendation.strategy.js';

export abstract class TeamCompositionOrchestrator {
  constructor(
    protected strategy: RecommendationStrategy
  ) {}

  public compose(
    project: Projeto,
    professionals: Profissional[]
  ): EquipeSugerida {
    const normalized =
      this.normalizeInput(project);

    this.validateBudgetAndDeadline(
      normalized,
      professionals
    );

    const ranked =
      this.applyStrategy(
        normalized,
        professionals
      );

    const finalTeam =
      this.postProcess(
        ranked,
        normalized
      );

    return finalTeam;
  }

  protected normalizeInput(
    project: Projeto
  ): Projeto {
    return {
      ...project,

      genero:
        project.genero
          .toLowerCase()
          .trim(),

      localizacao:
        project.localizacao
          .toLowerCase()
          .trim(),

      papeis:
        project.papeis.map(
          (p) => ({
            ...p,

            papel:
              p.papel
                .toLowerCase()
                .trim()
          })
        )
    };
  }

  protected validateBudgetAndDeadline(
    project: Projeto,
    professionals: Profissional[]
  ): void {
    if (
      project.orcamentoTotal <= 0
    ) {
      throw new Error(
        'Orçamento deve ser positivo.'
      );
    }

    if (
      professionals.length === 0
    ) {
      throw new Error(
        'Nenhum profissional disponível para avaliação.'
      );
    }

    const delivery =
      new Date(
        project.dataEntrega
      );

    if (
      Number.isNaN(
        delivery.getTime()
      )
    ) {
      throw new Error(
        'Data de entrega inválida.'
      );
    }

    if (
      delivery < new Date()
    ) {
      throw new Error(
        'Data de entrega já passou.'
      );
    }
  }

  protected applyStrategy(
    project: Projeto,
    professionals: Profissional[]
  ): Recomendacao[] {
    return this.strategy.recommend(
      project,
      professionals
    );
  }

  protected postProcess(
    recomendacoes: Recomendacao[],
    project: Projeto
  ): EquipeSugerida {
    const bestByRole =
      new Map<
        string,
        Recomendacao
      >();

    for (
      const recommendation
      of recomendacoes
    ) {
      const current =
        bestByRole.get(
          recommendation.papel
        );

      if (
        !current ||
        recommendation.score >
          current.score
      ) {
        bestByRole.set(
          recommendation.papel,
          recommendation
        );
      }
    }

    const finalRecs =
      Array.from(
        bestByRole.values()
      );

    /*
     * DIAGNÓSTICO TEMPORÁRIO
     *
     * Mostra exatamente quais profissionais
     * foram selecionados para cada papel,
     * seus preços e seus scores.
     */
    console.log(
      'RECOMENDAÇÕES SELECIONADAS:',
      finalRecs.map(
        (r) => ({
          papel: r.papel,
          profissional:
            r.profissional.nome,
          preco:
            r.profissional.precoMedio,
          score: r.score
        })
      )
    );

    const normalizedRoles =
      project.papeis.map(
        (p) =>
          p.papel
            .toLowerCase()
            .trim()
      );

    const selectedRoles =
      new Set(
        finalRecs.map(
          (r) =>
            r.papel
              .toLowerCase()
              .trim()
        )
      );

    const missingRoles =
      normalizedRoles.filter(
        (role) =>
          !selectedRoles.has(
            role
          )
      );

    if (
      missingRoles.length > 0
    ) {
      throw new Error(
        `Não foi possível preencher os papéis: ${missingRoles.join(', ')}.`
      );
    }

    const orcamentoEstimado =
      finalRecs.reduce(
        (
          sum,
          recommendation
        ) =>
          sum +
          recommendation
            .profissional
            .precoMedio,
        0
      );

    if (
      orcamentoEstimado >
      project.orcamentoTotal
    ) {
      throw new Error(
        `A equipe estimada (${orcamentoEstimado.toFixed(2)}) ultrapassa o orçamento do projeto (${project.orcamentoTotal.toFixed(2)}).`
      );
    }

    const scoreGeral =
      finalRecs.reduce(
        (
          sum,
          recommendation
        ) =>
          sum +
          recommendation.score,
        0
      ) /
      (
        finalRecs.length || 1
      );

    return {
      projetoId:
        project.id,

      recomendacoes:
        finalRecs,

      scoreGeral,

      orcamentoEstimado
    };
  }
}

export class DefaultTeamCompositionOrchestrator
  extends TeamCompositionOrchestrator {}