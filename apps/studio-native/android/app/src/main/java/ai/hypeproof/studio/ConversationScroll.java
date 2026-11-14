package ai.hypeproof.studio;

import android.content.Context;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import java.util.ArrayList;
import java.util.List;

/** View-local reading position; conversation data and drafts stay with the model. */
final class ConversationScroll extends ScrollView {
    private record Anchor(Object id,int offset) {}
    private record Position(boolean latest,int y,List<Anchor> anchors) {}
    private final LinearLayout rows;
    private Position pending;
    private boolean following=true,layingOut;
    private Runnable changed=()->{};

    ConversationScroll(Context context,LinearLayout rows){super(context);this.rows=rows;setFillViewport(true);setContentDescription("대화 기록");}
    void onPositionChanged(Runnable changed){this.changed=changed;}
    boolean atLatest(){return getChildCount()==0||getChildAt(0).getBottom()-getScrollY()-getHeight()<=nearDistance();}
    private int nearDistance(){return (int)(48*getResources().getDisplayMetrics().density);}
    private int rowTop(View row){return getChildAt(0).getTop()+rows.getTop()+row.getTop();}
    private Position position(){
        List<Anchor> anchors=new ArrayList<>();
        if(getChildCount()>0){
            for(int i=0;i<rows.getChildCount();i++){
                View row=rows.getChildAt(i);int offset=rowTop(row)-getScrollY();
                if(row.getTag()!=null&&offset+row.getHeight()>0)anchors.add(new Anchor(row.getTag(),offset));
            }
        }
        return new Position(following,getScrollY(),anchors);
    }
    void beforeContentChange(){if(pending==null)pending=position();requestLayout();}
    void showLatest(){following=true;pending=new Position(true,0,List.of());requestLayout();}
    @Override protected void onScrollChanged(int x,int y,int oldX,int oldY){
        super.onScrollChanged(x,y,oldX,oldY);
        if(!layingOut){
            following=atLatest();
            if(pending!=null){
                // A real scroll may arrive after content changed but before traversal.
                // Carry its movement into the saved geometry instead of rewinding it.
                List<Anchor> moved=new ArrayList<>();
                for(Anchor anchor:pending.anchors())moved.add(new Anchor(anchor.id(),anchor.offset()-(y-oldY)));
                pending=new Position(following,y,moved);
            }
            if(changed!=null)changed.run();
        }
    }
    @Override protected void onLayout(boolean changedBounds,int left,int top,int right,int bottom){
        Position keep=pending==null?position():pending;
        layingOut=true;
        try{
            super.onLayout(changedBounds,left,top,right,bottom);
            int target=keep.y();
            if(keep.latest())target=getChildCount()==0?0:getChildAt(0).getBottom();
            else if(!keep.anchors().isEmpty()){
                target=0;
                boolean found=false;
                for(Anchor anchor:keep.anchors()){
                    for(int i=0;i<rows.getChildCount();i++){
                        View row=rows.getChildAt(i);
                        if(anchor.id().equals(row.getTag())){target=rowTop(row)-anchor.offset();found=true;break;}
                    }
                    if(found)break;
                }
            }
            scrollTo(0,target);
            following=keep.latest()||atLatest();pending=null;
        }finally{layingOut=false;}
        changed.run();
    }
}
