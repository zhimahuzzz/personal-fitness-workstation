import React from 'react'

// 全局错误边界：任何页面渲染崩溃时显示可读提示，而不是整页空白
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell" style={{ paddingTop: '20vh', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>😵</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>页面出了点问题</div>
          <div className="hint" style={{ marginBottom: 20, wordBreak: 'break-all' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
