/**
 * 流程图源模型单测（flow-editor 数据层）
 * 契约正本：apps/flow-model.ts 头注释 + 《流程图应用设计（Mermaid+X6）》§三
 * 硬验收：未编辑 → serialize(parse(x)) === x（往返 diff 为空，raw 优先纪律）
 */
import { describe, expect, it } from 'vitest'
import {
  addNode,
  connect,
  escapeLabel,
  nodeToken,
  parseFlowchart,
  parseNodeToken,
  removeNode,
  serializeFlowchart,
  setNodeMeta,
  updateEdgeLabel,
  updateNode,
} from '../flow-model'

describe('parseNodeToken / escapeLabel（转义对称）', () => {
  it('四种形状 + 裸 id', () => {
    expect(parseNodeToken('A[文本]')).toEqual({ id: 'A', label: '文本', shape: 'rect', bare: false })
    expect(parseNodeToken('A(圆角)')).toEqual({ id: 'A', label: '圆角', shape: 'round', bare: false })
    expect(parseNodeToken('A((圆))')).toEqual({ id: 'A', label: '圆', shape: 'circle', bare: false })
    expect(parseNodeToken('A{菱}')).toEqual({ id: 'A', label: '菱', shape: 'diamond', bare: false })
    expect(parseNodeToken('B')).toEqual({ id: 'B', label: 'B', shape: 'rect', bare: true })
  })

  it('引号包裹 label：去引号还原；含特殊字符时序列化自动加引号，往返对称', () => {
    expect(parseNodeToken('A["含(括号)文本"]')!.label).toBe('含(括号)文本')
    const label = '特殊|文本"引号"'
    const tok = nodeToken({ id: 'X', label, shape: 'rect' })
    expect(parseNodeToken(tok)!.label).toBe(label)
    expect(escapeLabel('plain')).toBe('plain')
    expect(escapeLabel('a|b')).toBe('"a|b"')
  })

  it('非法 token → null', () => {
    expect(parseNodeToken('1不是合法id!')).toBeNull()
    expect(parseNodeToken('')).toBeNull()
  })

  it('多行 label：换行落为 \\n 转义序列（源单行），parseNodeToken 还原真换行（对称）', () => {
    const label = '第一行\n第二行'
    const tok = nodeToken({ id: 'M', label, shape: 'rect' })
    // 源保持单行：换行以字面 \n 两字序列进引号
    expect(tok).toBe('M["第一行\\n第二行"]')
    expect(tok.includes('\n')).toBe(false)
    // 还原对称
    expect(parseNodeToken(tok)).toMatchObject({ id: 'M', label, shape: 'rect' })
    // 反斜杠本身对称：a\b ↔ "a\\b"
    expect(parseNodeToken(nodeToken({ id: 'B', label: 'a\\b', shape: 'rect' }))!.label).toBe('a\\b')
  })

  it('多行边 label：updateEdgeLabel → 序列化 |"x\\ny"|；parse 还原真换行', () => {
    const m = parseFlowchart('graph TD\n  A --> B')
    m.edges[0]!.label = '通过\n复核'
    const out = serializeFlowchart(m)
    expect(out).toContain('A -->|"通过\\n复核"| B')
    expect(parseFlowchart(out).edges[0]!.label).toBe('通过\n复核')
  })
})

describe('parseFlowchart', () => {
  it('解析节点/边/meta/subgraph 透传行', () => {
    const src = `graph TD
  %% meta: schema=v1
  %% meta: B {"owner":"张三","sla":"4h"}
  A[提交申请] --> B{审批}
  B -->|通过| C[归档]
  subgraph 子流程
    C --> D((结束))
  end
`
    const m = parseFlowchart(src)
    expect(m.headerLine).toBe(0)
    expect(m.metaSchema).toBe('schema=v1')
    expect(m.nodes.get('A')).toMatchObject({ label: '提交申请', shape: 'rect' })
    expect(m.nodes.get('B')).toMatchObject({ label: '审批', shape: 'diamond' })
    expect(m.nodes.get('D')).toMatchObject({ label: '结束', shape: 'circle' })
    expect(m.nodes.get('B')!.meta).toEqual({ owner: '张三', sla: '4h' })
    expect(m.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['A', 'B', ''],
      ['B', 'C', '通过'],
      ['C', 'D', ''],
    ])
  })

  it('链式边 A --> B --> C 拆成两条', () => {
    const m = parseFlowchart('graph TD\n  A --> B --> C')
    expect(m.edges).toHaveLength(2)
    expect(m.edges[0]).toMatchObject({ from: 'A', to: 'B' })
    expect(m.edges[1]).toMatchObject({ from: 'B', to: 'C' })
  })

  it('非法语法行透传（不抛出、不丢失）', () => {
    const src = 'graph TD\n  A --> B\n  这不是合法语法 ### \n  classDef bad fill:#f00'
    const m = parseFlowchart(src)
    expect(m.edges).toHaveLength(1)
    const out = serializeFlowchart(m)
    expect(out).toContain('这不是合法语法 ###')
    expect(out).toContain('classDef bad fill:#f00')
  })
})

describe('serializeFlowchart（raw 优先）', () => {
  it('硬验收：未编辑 → 往返 diff 为空', () => {
    const src = `graph TD
  %% meta: schema=v1
  %% meta: B {"owner":"张三"}
  A[提交申请] --> B{审批}
  B -->|通过| C[归档]

  subgraph 子流程
    C --> D((结束))
  end
`
    expect(serializeFlowchart(parseFlowchart(src))).toBe(src)
  })

  it('编辑一处：仅目标行变化，透传行原样', () => {
    const src = 'graph TD\n  %% 注释保留\n  A[旧名] --> B{审批}\n  classDef x fill:#eee'
    const m = parseFlowchart(src)
    updateNode(m, 'A', { label: '新名' })
    const out = serializeFlowchart(m)
    expect(out).toContain('A[新名]')
    expect(out).toContain('%% 注释保留')
    expect(out).toContain('classDef x fill:#eee')
    expect(out).not.toContain('A[旧名]')
  })

  it('meta 编辑：meta 块在 header 后整体重建，正文行不动', () => {
    const src = 'graph TD\n  A[开始] --> B[结束]'
    const m = parseFlowchart(src)
    setNodeMeta(m, 'B', { owner: '李四' })
    const out = serializeFlowchart(m)
    const lines = out.split('\n')
    expect(lines[0]).toBe('graph TD')
    expect(lines[1]).toBe('%% meta: B {"owner":"李四"}')
    expect(lines.map((l) => l.trim())).toContain('A[开始] --> B[结束]')
  })

  it('新增节点/连边追加尾部；删除节点级联边', () => {
    const m = parseFlowchart('graph TD\n  A[开始] --> B{审批}')
    const id = addNode(m, '新增步骤')
    connect(m, 'B', id, '确认')
    let out = serializeFlowchart(m)
    expect(out).toContain('B -->|确认| n1[新增步骤]')

    removeNode(m, 'A')
    out = serializeFlowchart(m)
    expect(out).not.toContain('A[开始]')
    expect(out).toContain('B -->|确认| n1[新增步骤]')
  })

  it('边 label 编辑（updateEdgeLabel）', () => {
    const m = parseFlowchart('graph TD\n  A -->|旧| B')
    updateEdgeLabel(m, 0, '新')
    expect(serializeFlowchart(m)).toContain(`A -->|新| B`)
  })
})
