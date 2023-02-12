import * as React from 'react';

export interface TooltipRenderProps {
  focused: boolean;
}

export interface TooltipProps {
  info: string;
  children: JSX.Element | ((props: TooltipRenderProps) => JSX.Element);
  holdDuration?: number;
}

export interface TooltipState {
  visible: boolean;
  focused: boolean;
}

export class Tooltip extends React.Component<TooltipProps, TooltipState> {
  private timeout?: number;
  private skipMouseEnterEvent?: boolean;

  public static defaultProps = {
    holdDuration: 200,
  };

  public state = {
    visible: false,
    focused: false,
  };

  public queueShow = () => {
    this.setState({ focused: true });
    this.timeout = window.setTimeout(
      () => this.setState({ visible: true }),
      this.props.holdDuration,
    );
  };

  public hide = () => {
    window.clearTimeout(this.timeout);
    document.removeEventListener('touchstart', this.hide);
    this.setState({ visible: false, focused: false });
  };

  public onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    this.queueShow();
    e.stopPropagation();
    this.skipMouseEnterEvent = true;
    document.addEventListener('touchstart', this.hide);
  };

  public onMouseEnter = () => {
    if (this.skipMouseEnterEvent) {
      this.skipMouseEnterEvent = false;
    } else {
      this.queueShow();
    }
  };

  public render() {
    const { info, children } = this.props;
    const { visible, focused } = this.state;

    return (
      <div
        className="tooltip__wrapper"
        onTouchEnd={this.hide}
        onTouchStart={this.onTouchStart}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.hide}
      >
        {typeof children === 'function' ? children({ focused }) : children}
        {visible && (
          <div className="tooltip__tooltip">
            <div className="tooltip__content" data-text={info} />
            <div className="tooltip__arrow" />
            <div className="tooltip__gap" />
          </div>
        )}
      </div>
    );
  }
}
