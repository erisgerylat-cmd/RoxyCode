/**
 * 提问交互渲染器
 *
 * 当 Agent 通过 yield question 主动提问时，
 * 渲染问题并等待用户回答。
 * 
 * 增强功能：
 * - 支持单选/多选选项
 * - 键盘导航支持
 * - 更好的视觉呈现
 * - 默认值处理
 */

import chalk from 'chalk';
import type { Question } from '../../core/types/event.js';
import type { Character } from '../../aesthetic/character/types.js';
import * as readline from 'node:readline';

/** 问题选项 */
interface QuestionOption {
  label: string;
  value: string;
  recommended?: boolean;
}

/**
 * 渲染提问并等待用户回答
 *
 * @returns 用户的回答文本
 */
export async function renderQuestion(
  question: Question,
  character: Character,
): Promise<string> {
  const border = chalk.hex(character.theme.primary);
  const accent = chalk.hex(character.theme.accent);
  const dim = chalk.dim;

  console.log('');
  console.log(border('  ┌── ') + accent('❓ 问题') + border(' ──┐'));
  console.log(border('  │') + ' ' + chalk.white(question.text));

  if (question.options && question.options.length > 0) {
    console.log(border('  │'));
    
    // 显示选项
    for (let i = 0; i < question.options.length; i++) {
      const opt = question.options[i];
      const num = chalk.cyan(`[${i + 1}]`);
      const marker = opt.recommended
        ? accent('  ◆')
        : dim('  ◇');
      const label = chalk.white(opt.label);
      const recTag = opt.recommended ? accent(' [推荐]') : '';
      
      console.log(border('  │') + `${marker} ${num} ${label}${recTag}`);
    }
    
    console.log(border('  │'));
    console.log(border('  │') + dim('  输入数字选择，或直接输入文本'));
  }

  if (question.default) {
    console.log(border('  │') + dim(`  默认: ${question.default}`));
  }

  console.log(border('  └') + '─'.repeat(40) + border('┘'));
  console.log('');

  // 获取用户输入
  return new Promise((resolve) => {
    const rl = readline.createInterface({ 
      input: process.stdin, 
      output: process.stdout,
      terminal: true,
    });

    const prompt = chalk.hex(character.theme.primary)('  ❯ ');
    
    rl.question(prompt, (answer: string) => {
      rl.close();
      
      const trimmed = answer.trim();
      
      // 处理数字选择
      if (question.options && question.options.length > 0) {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= question.options.length) {
          resolve(question.options[num - 1].value);
          return;
        }
      }
      
      // 使用默认值
      if (!trimmed && question.default) {
        resolve(question.default);
        return;
      }
      
      resolve(trimmed);
    });
  });
}

/**
 * 渲染确认对话框
 *
 * @returns 用户是否确认
 */
export async function renderConfirmation(
  message: string,
  character: Character,
  defaultValue: boolean = false,
): Promise<boolean> {
  const border = chalk.hex(character.theme.primary);
  const accent = chalk.hex(character.theme.accent);
  const dim = chalk.dim;

  console.log('');
  console.log(border('  ┌── ') + accent('确认') + border(' ──┐'));
  console.log(border('  │') + ' ' + chalk.white(message));
  console.log(border('  │'));
  
  const yesLabel = defaultValue ? '[Y/n]' : '[y/N]';
  console.log(border('  │') + dim(`  ${yesLabel} ${defaultValue ? '默认: 是' : '默认: 否'}`));
  
  console.log(border('  └') + '─'.repeat(40) + border('┘'));
  console.log('');

  return new Promise((resolve) => {
    const rl = readline.createInterface({ 
      input: process.stdin, 
      output: process.stdout,
      terminal: true,
    });

    const prompt = chalk.hex(character.theme.primary)('  ❯ ');
    
    rl.question(prompt, (answer: string) => {
      rl.close();
      
      const trimmed = answer.trim().toLowerCase();
      
      if (!trimmed) {
        resolve(defaultValue);
        return;
      }
      
      resolve(trimmed === 'y' || trimmed === 'yes' || trimmed === '是');
    });
  });
}

/**
 * 渲染输入框
 *
 * @returns 用户输入的文本
 */
export async function renderInputBox(
  prompt: string,
  character: Character,
  defaultValue?: string,
  validator?: (input: string) => string | null,
): Promise<string> {
  const border = chalk.hex(character.theme.primary);
  const accent = chalk.hex(character.theme.accent);
  const dim = chalk.dim;

  console.log('');
  console.log(border('  ┌── ') + accent('输入') + border(' ──┐'));
  console.log(border('  │') + ' ' + chalk.white(prompt));
  
  if (defaultValue) {
    console.log(border('  │') + dim(`  默认: ${defaultValue}`));
  }
  
  console.log(border('  └') + '─'.repeat(40) + border('┘'));
  console.log('');

  const ask = (): Promise<string> => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout,
        terminal: true,
      });

      const promptStr = chalk.hex(character.theme.primary)('  ❯ ');
      
      rl.question(promptStr, (answer: string) => {
        rl.close();
        
        const trimmed = answer.trim();
        
        if (!trimmed && defaultValue) {
          resolve(defaultValue);
          return;
        }
        
        // 验证输入
        if (validator) {
          const error = validator(trimmed);
          if (error) {
            console.log(chalk.red(`  ✗ ${error}`));
            resolve(ask());
            return;
          }
        }
        
        resolve(trimmed);
      });
    });
  };

  return ask();
}

/**
 * 渲染多选问题
 *
 * @returns 用户选择的值数组
 */
export async function renderMultiSelect(
  question: string,
  options: QuestionOption[],
  character: Character,
  defaultValues?: string[],
): Promise<string[]> {
  const border = chalk.hex(character.theme.primary);
  const accent = chalk.hex(character.theme.accent);
  const dim = chalk.dim;
  const selected = new Set<string>(defaultValues || []);

  const render = () => {
    console.clear();
    console.log('');
    console.log(border('  ┌── ') + accent('多选') + border(' ──┐'));
    console.log(border('  │') + ' ' + chalk.white(question));
    console.log(border('  │'));
    
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const num = chalk.cyan(`[${i + 1}]`);
      const isSelected = selected.has(opt.value);
      const marker = isSelected ? accent('  ✓') : dim('  ○');
      const label = isSelected ? chalk.white.bold(opt.label) : chalk.white(opt.label);
      
      console.log(border('  │') + `${marker} ${num} ${label}`);
    }
    
    console.log(border('  │'));
    console.log(border('  │') + dim('  输入数字切换选择，输入 "done" 确认'));
    console.log(border('  └') + '─'.repeat(40) + border('┘'));
    console.log('');
  };

  render();

  return new Promise((resolve) => {
    const rl = readline.createInterface({ 
      input: process.stdin, 
      output: process.stdout,
      terminal: true,
    });

    const prompt = chalk.hex(character.theme.primary)('  ❯ ');
    
    const ask = () => {
      rl.question(prompt, (answer: string) => {
        const trimmed = answer.trim().toLowerCase();
        
        if (trimmed === 'done' || trimmed === '') {
          rl.close();
          resolve(Array.from(selected));
          return;
        }
        
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= options.length) {
          const value = options[num - 1].value;
          if (selected.has(value)) {
            selected.delete(value);
          } else {
            selected.add(value);
          }
          render();
        }
        
        ask();
      });
    };

    ask();
  });
}
