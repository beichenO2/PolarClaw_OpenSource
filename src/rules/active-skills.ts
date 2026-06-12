/** 当前会话已激活 Skill 的规则注入（显式调用层，非正则触发） */
const activeSkillRules = new Map<string, string>()

export function setActiveSkillRules(skillName: string, rulesText: string): void {
  if (rulesText.trim()) activeSkillRules.set(skillName, rulesText.trim())
}

export function clearActiveSkillRules(skillName: string): void {
  activeSkillRules.delete(skillName)
}

export function getActiveSkillRulesPrompt(): string {
  if (activeSkillRules.size === 0) return ''
  const blocks = Array.from(activeSkillRules.entries()).map(
    ([name, body]) => `## Active Skill: ${name}\n\n${body}`,
  )
  return `# Active Skill Rules\n\n${blocks.join('\n\n---\n\n')}`
}
