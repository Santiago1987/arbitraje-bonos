import type {
  ArbitrageOperation,
  Exercise,
  ExerciseCycle,
  ExerciseDetail,
  ExerciseState,
  OperationSide,
} from "@arbitraje/shared";
import {
  ArbitrageOperationModel,
  BondPairModel,
  ExerciseModel,
} from "../models.js";

// Tolerancia para considerar que el saldo neto de nominales "volvió a 0".
// Las cantidades suelen ser enteros millonarios; 1e-6 es suficiente para
// absorber ruido de floats en sumas/restas.
const ZERO_TOLERANCE = 1e-6;

// Factor que aparece en la planilla original del usuario: multiplica las
// compras y divide las ventas. Origen desconocido (probablemente comisión
// implícita o markup); se deja como constante para tocarlo fácil después.
const OPERATION_FEE_FACTOR = 1.0001;

// Los precios cotizan cada 100 nominales: monto real = nominales × precio / 100.
const PRICE_DIVISOR = 100;

interface CreateOperationInput {
  side: OperationSide;
  // Cantidades positivas; el signo lo determina `side`.
  nominalsA: number;
  nominalsB: number;
  priceA: number;
  priceB: number;
  timestamp?: Date;
  notes?: string;
}

interface UpdateOperationInput {
  side?: OperationSide;
  nominalsA?: number;
  nominalsB?: number;
  priceA?: number;
  priceB?: number;
  timestamp?: Date;
  notes?: string;
}

function operationDocToDTO(raw: {
  _id: { toString(): string };
}): ArbitrageOperation {
  const doc = raw as Record<string, unknown> & { _id: { toString(): string } };
  return {
    id: doc._id.toString(),
    exerciseId: doc.exerciseId as string,
    pairId: doc.pairId as string,
    timestamp: doc.timestamp as Date,
    side: doc.side as OperationSide,
    nominalsA: doc.nominalsA as number,
    priceA: doc.priceA as number,
    nominalsB: doc.nominalsB as number,
    priceB: doc.priceB as number,
    executedRatio: doc.executedRatio as number,
    notes: (doc.notes as string) ?? "",
  };
}

function exerciseDocToDTO(raw: { _id: { toString(): string } }): Exercise {
  const doc = raw as Record<string, unknown> & { _id: { toString(): string } };
  return {
    id: doc._id.toString(),
    pairId: doc.pairId as string,
    pairName: doc.pairName as string,
    name: doc.name as string,
    status: doc.status as Exercise["status"],
    openedAt: doc.openedAt as Date,
    closedAt: (doc.closedAt as Date | null) ?? null,
    openingNotes: (doc.openingNotes as string) ?? "",
    closingNotes: (doc.closingNotes as string) ?? "",
    realizedPnL: (doc.realizedPnL as number) ?? 0,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

// Aplica el signo según el lado: buy_ratio → compré A (+) y vendí B (-);
// sell_ratio → vendí A (-) y compré B (+). Las cantidades A y B son
// independientes (porque el equilibrio del arbitraje es por monto, no por
// cantidad de nominales).
function applySigns(
  side: OperationSide,
  nominalsA: number,
  nominalsB: number,
): { nominalsA: number; nominalsB: number } {
  const a = Math.abs(nominalsA);
  const b = Math.abs(nominalsB);
  if (side === "buy_ratio") return { nominalsA: a, nominalsB: -b };
  return { nominalsA: -a, nominalsB: b };
}

// Cash flow de una pata según fórmula de la planilla:
//   compra (n > 0): paga n × p / 100 × FEE  → cash flow negativo
//   venta  (n < 0): cobra |n| × p / 100 / FEE → cash flow positivo
function legCashFlow(signedNominals: number, price: number): number {
  if (signedNominals === 0) return 0;
  const base = (signedNominals * price) / PRICE_DIVISOR;
  if (signedNominals > 0) return -base * OPERATION_FEE_FACTOR; // compra: paga más
  return -base / OPERATION_FEE_FACTOR; // venta: cobra menos (-base es positivo)
}

class ArbitrageOperationsService {
  // ---- Cálculo de PnL por ciclos --------------------------------------

  // Recorre las operaciones de un ejercicio en orden cronológico y devuelve
  // el estado completo: balance neto actual, PnL realizado por ciclos
  // cerrados (= cuando el saldo de A y B vuelve a 0), y cash flow del
  // ciclo abierto.
  computeState(operations: ArbitrageOperation[]): ExerciseState {
    let cashFlow = 0;
    let netA = 0;
    let netB = 0;
    let realizedPnL = 0;
    const cycles: ExerciseCycle[] = [];

    const sorted = [...operations].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    for (const op of sorted) {
      cashFlow += legCashFlow(op.nominalsA, op.priceA);
      cashFlow += legCashFlow(op.nominalsB, op.priceB);
      netA += op.nominalsA;
      netB += op.nominalsB;

      if (
        Math.abs(netA) < ZERO_TOLERANCE &&
        Math.abs(netB) < ZERO_TOLERANCE
      ) {
        realizedPnL += cashFlow;
        cycles.push({
          closedAtOperationId: op.id,
          closedAt: op.timestamp,
          pnl: cashFlow,
        });
        cashFlow = 0;
        netA = 0;
        netB = 0;
      }
    }

    return {
      netNominalsA: netA,
      netNominalsB: netB,
      realizedPnL,
      openCycleCashFlow: cashFlow,
      cycles,
    };
  }

  // ---- Ejercicios -----------------------------------------------------

  async listExercisesForPair(pairId: string): Promise<Exercise[]> {
    const docs = await ExerciseModel.find({ pairId })
      .sort({ status: 1, openedAt: -1 }) // "closed" < "open" por orden alfabético — invierto abajo
      .lean();
    // Queremos: abierto primero, luego cerrados desc por openedAt.
    docs.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.openedAt.getTime() - a.openedAt.getTime();
    });
    return docs.map(exerciseDocToDTO);
  }

  // Devuelve los pairId que tienen (al menos) un ejercicio abierto. Se usa
  // para marcar esos pares en la tabla principal.
  async listOpenExercisePairIds(): Promise<string[]> {
    const ids = await ExerciseModel.distinct("pairId", { status: "open" });
    return ids.map((id) => String(id));
  }

  async openExercise(
    pairId: string,
    name: string,
    openingNotes: string,
  ): Promise<Exercise> {
    const pair = await BondPairModel.findById(pairId).lean();
    if (!pair) throw new Error("Par no encontrado");

    const existingOpen = await ExerciseModel.findOne({
      pairId,
      status: "open",
    }).lean();
    if (existingOpen) {
      throw new Error(
        `Ya existe un ejercicio abierto para este par: "${existingOpen.name}". Cerralo antes de abrir uno nuevo.`,
      );
    }

    const doc = await ExerciseModel.create({
      pairId,
      pairName: pair.name,
      name,
      status: "open",
      openedAt: new Date(),
      closedAt: null,
      openingNotes: openingNotes ?? "",
      closingNotes: "",
      realizedPnL: 0,
    });

    return exerciseDocToDTO(doc.toObject());
  }

  async closeExercise(
    exerciseId: string,
    closingNotes: string,
  ): Promise<Exercise> {
    const exercise = await ExerciseModel.findById(exerciseId);
    if (!exercise) throw new Error("Ejercicio no encontrado");
    if (exercise.status === "closed") {
      throw new Error("El ejercicio ya está cerrado");
    }

    // Recalcular PnL final antes de cerrar.
    const operations = await this.listOperations(exerciseId);
    const state = this.computeState(operations);

    exercise.status = "closed";
    exercise.closedAt = new Date();
    exercise.closingNotes = closingNotes ?? "";
    exercise.realizedPnL = state.realizedPnL;
    await exercise.save();

    return exerciseDocToDTO(exercise.toObject());
  }

  async getExerciseDetail(exerciseId: string): Promise<ExerciseDetail | null> {
    const exercise = await ExerciseModel.findById(exerciseId).lean();
    if (!exercise) return null;

    const operations = await this.listOperations(exerciseId);
    const state = this.computeState(operations);

    return {
      exercise: exerciseDocToDTO(exercise),
      operations,
      state,
    };
  }

  // ---- Operaciones ----------------------------------------------------

  async listOperations(exerciseId: string): Promise<ArbitrageOperation[]> {
    const docs = await ArbitrageOperationModel.find({ exerciseId })
      .sort({ timestamp: 1 })
      .lean();
    return docs.map(operationDocToDTO);
  }

  async createOperation(
    exerciseId: string,
    input: CreateOperationInput,
  ): Promise<ArbitrageOperation> {
    const exercise = await ExerciseModel.findById(exerciseId).lean();
    if (!exercise) throw new Error("Ejercicio no encontrado");
    if (exercise.status === "closed") {
      throw new Error("No se pueden agregar operaciones a un ejercicio cerrado");
    }
    if (input.priceB === 0) throw new Error("Precio B no puede ser 0");
    if (input.nominalsA <= 0 || input.nominalsB <= 0) {
      throw new Error("Los nominales de A y B deben ser positivos");
    }

    const { nominalsA, nominalsB } = applySigns(
      input.side,
      input.nominalsA,
      input.nominalsB,
    );

    const doc = await ArbitrageOperationModel.create({
      exerciseId,
      pairId: exercise.pairId,
      timestamp: input.timestamp ?? new Date(),
      side: input.side,
      nominalsA,
      priceA: input.priceA,
      nominalsB,
      priceB: input.priceB,
      executedRatio: input.priceA / input.priceB,
      notes: input.notes ?? "",
    });

    await this.recomputeAndPersistPnL(exerciseId);

    return operationDocToDTO(doc.toObject());
  }

  async updateOperation(
    operationId: string,
    input: UpdateOperationInput,
  ): Promise<ArbitrageOperation> {
    const op = await ArbitrageOperationModel.findById(operationId);
    if (!op) throw new Error("Operación no encontrada");

    const exercise = await ExerciseModel.findById(op.exerciseId).lean();
    if (!exercise) throw new Error("Ejercicio no encontrado");
    if (exercise.status === "closed") {
      throw new Error("No se pueden editar operaciones de un ejercicio cerrado");
    }

    const newSide = input.side ?? op.side;
    const newNominalsA =
      input.nominalsA !== undefined
        ? Math.abs(input.nominalsA)
        : Math.abs(op.nominalsA);
    const newNominalsB =
      input.nominalsB !== undefined
        ? Math.abs(input.nominalsB)
        : Math.abs(op.nominalsB);
    const newPriceA = input.priceA ?? op.priceA;
    const newPriceB = input.priceB ?? op.priceB;
    if (newPriceB === 0) throw new Error("Precio B no puede ser 0");
    if (newNominalsA <= 0 || newNominalsB <= 0) {
      throw new Error("Los nominales de A y B deben ser positivos");
    }

    const { nominalsA, nominalsB } = applySigns(
      newSide,
      newNominalsA,
      newNominalsB,
    );

    op.side = newSide;
    op.nominalsA = nominalsA;
    op.nominalsB = nominalsB;
    op.priceA = newPriceA;
    op.priceB = newPriceB;
    op.executedRatio = newPriceA / newPriceB;
    if (input.timestamp !== undefined) op.timestamp = input.timestamp;
    if (input.notes !== undefined) op.notes = input.notes;
    await op.save();

    await this.recomputeAndPersistPnL(op.exerciseId);

    return operationDocToDTO(op.toObject());
  }

  async deleteOperation(operationId: string): Promise<void> {
    const op = await ArbitrageOperationModel.findById(operationId);
    if (!op) return;

    const exercise = await ExerciseModel.findById(op.exerciseId).lean();
    if (exercise?.status === "closed") {
      throw new Error("No se pueden borrar operaciones de un ejercicio cerrado");
    }

    const exerciseId = op.exerciseId;
    await op.deleteOne();
    await this.recomputeAndPersistPnL(exerciseId);
  }

  // ---- Helpers internos -----------------------------------------------

  private async recomputeAndPersistPnL(exerciseId: string): Promise<void> {
    const operations = await this.listOperations(exerciseId);
    const state = this.computeState(operations);
    await ExerciseModel.findByIdAndUpdate(exerciseId, {
      realizedPnL: state.realizedPnL,
    });
  }
}

export const arbitrageOperationsService = new ArbitrageOperationsService();
