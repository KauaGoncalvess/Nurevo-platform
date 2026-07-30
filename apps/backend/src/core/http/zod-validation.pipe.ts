import { BadRequestException } from "@nestjs/common";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Valida o body contra um schema zod. Uso: `@Body(new ZodPipe(schema))`.
 *
 * O que sai daqui é o resultado do parse, não o body cru — então campos extras
 * enviados pelo cliente são descartados em vez de trafegarem para o banco.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: "Dados inválidos.",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    return result.data;
  }
}
